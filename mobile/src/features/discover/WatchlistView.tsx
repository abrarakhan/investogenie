import { useCallback, useEffect, useState } from "react";
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, TextInput, View } from "react-native";
import {
  addToWatchlist, getWatchlist, removeFromWatchlist, type Market, type MobileWatchlistItem,
} from "../../api";
import { Card } from "../../design/Card";
import { CardListSkeleton } from "../../design/Skeleton";
import { colors, hapticSuccess, hapticWarning, radius, spacing, tabularNums } from "../../design/tokens";
import { errorMessage, money, pct } from "../../format";
import { Banner, Empty, ScreenHead } from "../../ui";

export function WatchlistView({ market }: { market: Market }) {
  const [items, setItems] = useState<MobileWatchlistItem[]>([]);
  const [ticker, setTicker] = useState("");
  const [refreshing, setRefreshing] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setRefreshing(true);
    setError("");
    try {
      const result = await getWatchlist(market);
      setItems(result.items);
    } catch (cause) {
      setError(errorMessage(cause, "Could not load watchlist"));
    } finally {
      setRefreshing(false);
    }
  }, [market]);

  useEffect(() => {
    let active = true;
    getWatchlist(market)
      .then((result) => { if (active) setItems(result.items); })
      .catch((cause) => { if (active) setError(errorMessage(cause, "Could not load watchlist")); })
      .finally(() => { if (active) setRefreshing(false); });
    return () => { active = false; };
  }, [market]);

  const add = async () => {
    const clean = ticker.trim().toUpperCase();
    if (!clean || busy) return;
    setBusy(true);
    setError("");
    try {
      await addToWatchlist(market, clean);
      hapticSuccess();
      setTicker("");
      await load();
    } catch (cause) {
      hapticWarning();
      setError(errorMessage(cause, `Could not add ${clean}`));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (item: MobileWatchlistItem) => {
    setError("");
    try {
      await removeFromWatchlist(item.id);
      hapticSuccess();
      setItems((current) => current.filter((row) => row.id !== item.id));
    } catch (cause) {
      hapticWarning();
      setError(errorMessage(cause, `Could not remove ${item.ticker}`));
    }
  };

  return (
    <View style={styles.flex}>
      <ScreenHead title="Watchlist" subtitle="Tracked stocks synced with your web watchlist." />
      <View style={styles.addRow}>
        <TextInput
          style={[styles.input, styles.flex]}
          value={ticker}
          onChangeText={setTicker}
          onSubmitEditing={() => { void add(); }}
          returnKeyType="done"
          placeholder={market === "IN" ? "Add NSE ticker (e.g. RELIANCE)" : "Add US ticker (e.g. NVDA)"}
          placeholderTextColor={colors.textSubtle}
          autoCapitalize="characters"
          autoCorrect={false}
        />
        <Pressable onPress={() => { void add(); }} disabled={busy || !ticker.trim()} style={[styles.addBtn, (busy || !ticker.trim()) && styles.disabled]}>
          <Text style={styles.addBtnText}>{busy ? "…" : "Add"}</Text>
        </Pressable>
      </View>
      {!!error && <Banner>{error}</Banner>}
      {refreshing && !items.length ? (
        <CardListSkeleton count={3} />
      ) : (
        <FlatList
          data={items}
          keyExtractor={(item) => item.id}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={load} tintColor={colors.emerald} />}
          contentContainerStyle={styles.list}
          ListEmptyComponent={!refreshing ? <Empty>No symbols in your {market} watchlist yet.</Empty> : null}
          renderItem={({ item }) => (
            <Card>
              <View style={styles.rowBetween}>
                <View style={styles.flex}>
                  <Text style={styles.ticker}>{item.ticker}</Text>
                  <Text style={styles.meta} numberOfLines={1}>
                    {[item.exchange, item.name].filter(Boolean).join(" · ")}
                  </Text>
                </View>
                <View style={styles.priceCol}>
                  <Text style={styles.price}>{item.price === null ? "--" : money(item.price, market)}</Text>
                  <Text style={item.changePct !== null && item.changePct >= 0 ? styles.good : styles.bad}>
                    {pct(item.changePct)}
                  </Text>
                </View>
                <Pressable onPress={() => { void remove(item); }} style={styles.removeBtn}>
                  <Text style={styles.removeText}>Remove</Text>
                </Pressable>
              </View>
            </Card>
          )}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  addRow: { flexDirection: "row", paddingHorizontal: 14, paddingBottom: spacing.sm, gap: spacing.sm },
  input: {
    color: colors.text,
    backgroundColor: colors.surface,
    borderColor: colors.borderStrong,
    borderWidth: 1,
    borderRadius: radius.md,
    paddingHorizontal: 14,
    height: 46,
  },
  addBtn: {
    backgroundColor: colors.emerald,
    borderRadius: radius.md,
    paddingHorizontal: 18,
    height: 46,
    alignItems: "center",
    justifyContent: "center",
  },
  disabled: { opacity: 0.45 },
  addBtnText: { color: colors.emeraldInk, fontSize: 13, fontWeight: "900" },
  list: { padding: 14, gap: 10, paddingBottom: spacing.xxl },
  rowBetween: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 10 },
  ticker: { color: colors.text, fontSize: 17, fontWeight: "900" },
  meta: { color: colors.textSubtle, fontSize: 12, marginTop: 2 },
  priceCol: { alignItems: "flex-end" },
  price: { color: colors.text, fontSize: 14, fontWeight: "800", ...tabularNums },
  good: { color: colors.emerald, fontSize: 12, fontWeight: "800", ...tabularNums },
  bad: { color: colors.rose, fontSize: 12, fontWeight: "800", ...tabularNums },
  removeBtn: { paddingHorizontal: 8, paddingVertical: 6 },
  removeText: { color: colors.rose, fontSize: 11, fontWeight: "800" },
});
