-- Preserve adjusted US candles for analytics and store the feed's unadjusted
-- close separately for the shared quote. Legacy bars have no such provenance.
alter table public.daily_ohlcv add column if not exists unadjusted_close numeric;

create or replace function public.protect_final_stock_bar()
returns trigger language plpgsql as $$
begin
  if old.source in ('NSE_BHAVCOPY', 'BSE_BHAVCOPY', 'YAHOO_FINANCE_EOD')
     and new.source is distinct from old.source then
    return null;
  end if;
  return new;
end;
$$;

drop trigger if exists protect_final_stock_bar on public.daily_ohlcv;
create trigger protect_final_stock_bar before update on public.daily_ohlcv
for each row execute function public.protect_final_stock_bar();

create or replace function public.prefer_final_stock_quote()
returns trigger language plpgsql as $$
declare
  final_source text;
  final_price numeric;
  previous_close numeric;
  adjusted_close numeric;
begin
  if tg_op = 'UPDATE' and old.as_of is not null
     and (new.as_of is null or new.as_of < old.as_of)
     and exists (select 1 from public.assets where id = new.asset_id and asset_class = 'STOCK') then
    return null;
  end if;

  if tg_op = 'UPDATE' and old.as_of = new.as_of and new.source = 'NASDAQ'
     and old.source = 'YAHOO_FINANCE_LIVE'
     and old.updated_at >= now() - interval '7 minutes' then
    return null;
  end if;

  select b.source, coalesce(b.unadjusted_close, b.close), b.close
    into final_source, final_price, adjusted_close
    from public.daily_ohlcv b
    join public.assets a on a.id = b.asset_id
   where b.asset_id = new.asset_id and b.date = new.as_of and a.asset_class = 'STOCK'
     and ((a.country = 'IN' and b.source = a.exchange || '_BHAVCOPY' and a.exchange in ('NSE', 'BSE'))
          or (a.country = 'US' and b.source = 'YAHOO_FINANCE_EOD' and b.unadjusted_close > 0));

  if final_price > 0 then
    if new.source is distinct from final_source or new.change_pct is null then
      if tg_op = 'UPDATE' and old.as_of = new.as_of and old.source = final_source
         and old.price = round(final_price, 6) and old.change_pct is not null then
        new.change_pct := old.change_pct;
      else
        select b.close into previous_close from public.daily_ohlcv b
         where b.asset_id = new.asset_id and b.date < new.as_of
         order by b.date desc limit 1;
        new.change_pct := case when previous_close > 0 then (adjusted_close / previous_close - 1) * 100 end;
      end if;
    end if;
    new.price := final_price;
    new.source := final_source;
    new.best_bid := null;
    new.best_ask := null;
    new.bid_quantity := null;
    new.ask_quantity := null;
    new.total_buy_quantity := null;
    new.total_sell_quantity := null;
    new.lower_circuit := null;
    new.upper_circuit := null;
    new.vwap := null;
    new.session_volume := null;
    new.session_volume_date := null;
    new.session_volume_source := null;
    new.session_volume_at := null;

    if tg_op = 'UPDATE' and (to_jsonb(new) - 'updated_at') = (to_jsonb(old) - 'updated_at') then
      return null;
    end if;
  elsif tg_op = 'UPDATE' and old.as_of = new.as_of
     and old.source in ('NSE_BHAVCOPY', 'BSE_BHAVCOPY', 'YAHOO_FINANCE_EOD')
     and new.source is distinct from old.source then
    return null;
  end if;
  return new;
end;
$$;

drop trigger if exists prefer_final_stock_quote on public.latest_quotes;
create trigger prefer_final_stock_quote before insert or update on public.latest_quotes
for each row execute function public.prefer_final_stock_quote();

-- Call after the bar transaction commits. The Breeze worker locks quotes before
-- bars, so performing this inside a bar-writing transaction reverses lock order.
create or replace function public.promote_final_stock_quotes(
  market text, exchange_code text default null, session_date date default null, stock_id uuid default null
)
returns void language sql as $$
  insert into public.latest_quotes (asset_id, price, currency, as_of, source)
  select a.id, coalesce(b.unadjusted_close, b.close), a.currency, b.date, b.source
    from public.assets a
    left join public.latest_quotes q on q.asset_id = a.id
    cross join lateral (
      select d.date, d.close, d.unadjusted_close, d.source
        from public.daily_ohlcv d
       where d.asset_id = a.id and (session_date is null or d.date = session_date)
         and (q.as_of is null or d.date >= q.as_of)
         and ((market = 'IN' and a.exchange in ('NSE', 'BSE') and d.source = a.exchange || '_BHAVCOPY')
           or (market = 'US' and d.source = 'YAHOO_FINANCE_EOD' and d.unadjusted_close > 0))
       order by d.date desc limit 1
    ) b
   where a.country = market and a.asset_class = 'STOCK'
     and (exchange_code is null or a.exchange = exchange_code)
     and (stock_id is null or a.id = stock_id)
     and b.close > 0
     and (q.as_of, q.source, q.price) is distinct from
         (b.date, b.source, round(coalesce(b.unadjusted_close, b.close), 6))
   order by a.id
  on conflict (asset_id) do update set
    price = excluded.price, change_pct = excluded.change_pct, currency = excluded.currency,
    as_of = excluded.as_of, source = excluded.source, updated_at = now()
  where latest_quotes.as_of is null or latest_quotes.as_of <= excluded.as_of;
$$;

select public.promote_final_stock_quotes('IN');
