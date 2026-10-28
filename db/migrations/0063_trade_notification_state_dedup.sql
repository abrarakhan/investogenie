-- Older trade-alert signatures included live percentage text, so the same
-- recommendation could create a new delivery row after every quote refresh.
-- Retain only the newest equivalent delivery row for each trade and market day.
delete from public.browser_notification_events duplicate
 using public.browser_notification_events survivor
 where duplicate.kind='TRADE_ACTION'
   and survivor.kind='TRADE_ACTION'
   and duplicate.user_id=survivor.user_id
   and duplicate.trade_id=survivor.trade_id
   and duplicate.market_date=survivor.market_date
   and duplicate.title=survivor.title
   and duplicate.body=survivor.body
   and duplicate.id<survivor.id;

-- Move the per-trade cursor from the legacy
-- recommendation|risk|progress|changing-reason form to the stable
-- trade-id|recommendation|risk|progress form without emitting a transition.
update public.mobile_trade_alert_state
   set last_signature=trade_id::text || '|'
     || split_part(last_signature,'|',1) || '|'
     || split_part(last_signature,'|',2) || '|'
     || split_part(last_signature,'|',3)
 where last_signature is not null
   and last_signature not like trade_id::text || '|%'
   and split_part(last_signature,'|',1)<>''
   and split_part(last_signature,'|',2)<>''
   and split_part(last_signature,'|',3)<>'';
