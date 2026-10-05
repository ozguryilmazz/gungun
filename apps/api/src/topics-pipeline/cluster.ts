// Benzer başlıkları konulara gruplar. Zincirleme birleşmeyi (A~B, B~C ⇒ A~C) önlemek için
// her başlık, kümenin "çekirdek" kelimeleriyle karşılaştırılır. Mevcut konuya bağlı haberler
// kümelerini korur; böylece konu kimliği çalıştırmalar arasında sabit kalır.
import { tokenize } from "./text.ts";

export interface ClusterInput {
  id: number;
  title: string;
  url: string;
  publisherId: number | null;
  at: Date;
  /** Daha önce bağlandığı konu (varsa) */
  topicId: string | null;
}

export interface Cluster {
  topicId: string | null;
  items: ClusterInput[];
  tokenCounts: Map<string, number>;
  /** Önbellek: küme değişince sıfırlanır */
  core?: Set<string> | undefined;
}

/** Benzerlik eşiği ve en az ortak çekirdek kelime sayısı */
export const SIMILARITY_THRESHOLD = 0.5;
export const MIN_SHARED_TOKENS = 2;
export const MIN_ITEM_COVERAGE = 0.3;

export function computeIdf(docs: string[][]): Map<string, number> {
  const df = new Map<string, number>();
  for (const tokens of docs) for (const t of tokens) df.set(t, (df.get(t) ?? 0) + 1);
  const n = Math.max(docs.length, 1);
  const idf = new Map<string, number>();
  for (const [t, f] of df) idf.set(t, Math.log(1 + n / f));
  return idf;
}

/** Kümede belgelerin en az üçte birinde geçen kelimeler */
export function coreTokens(cluster: Cluster): Set<string> {
  if (cluster.core) return cluster.core;
  const min = Math.max(1, Math.ceil(cluster.items.length * 0.34));
  const core = new Set<string>();
  for (const [t, c] of cluster.tokenCounts) if (c >= min) core.add(t);
  cluster.core = core;
  return core;
}

/**
 * Benzerlik: paylaşılan ana kelimelerin ağırlığı / (başlığın veya çekirdeğin) küçük olanının ağırlığı.
 * En az 2 ortak ana kelime ve başlığın kendi ağırlığının en az %30'u ortak olmalı
 * (yalnızca "Merkez Bankası" gibi genel ifadeyi paylaşan farklı haberler birleşmesin).
 */
export function similarity(tokens: string[], core: Set<string>, idf: Map<string, number>): number {
  let shared = 0;
  let sharedWeight = 0;
  let itemWeight = 0;
  for (const t of tokens) {
    const w = idf.get(t) ?? 1;
    itemWeight += w;
    if (core.has(t)) {
      shared++;
      sharedWeight += w;
    }
  }
  if (shared < MIN_SHARED_TOKENS || itemWeight === 0) return 0;
  if (sharedWeight / itemWeight < MIN_ITEM_COVERAGE) return 0;
  let coreWeight = 0;
  for (const t of core) coreWeight += idf.get(t) ?? 1;
  return sharedWeight / Math.min(itemWeight, coreWeight);
}

/** kelime → o kelimeyi içeren kümeler (yalnızca ortak kelimesi olan kümeler karşılaştırılır) */
type TokenIndex = Map<string, Set<Cluster>>;

function addItem(cluster: Cluster, item: ClusterInput, tokens: string[], index: TokenIndex) {
  cluster.items.push(item);
  cluster.core = undefined;
  for (const t of tokens) {
    cluster.tokenCounts.set(t, (cluster.tokenCounts.get(t) ?? 0) + 1);
    let set = index.get(t);
    if (!set) index.set(t, (set = new Set()));
    set.add(cluster);
  }
}

export function clusterItems(items: ClusterInput[]): Cluster[] {
  const tokensById = new Map(items.map((i) => [i.id, tokenize(i.title)]));
  const idf = computeIdf([...tokensById.values()]);

  // 1) Mevcut konulara bağlı haberler kendi kümelerinde kalır
  const byTopic = new Map<string, Cluster>();
  const clusters: Cluster[] = [];
  const index: TokenIndex = new Map();
  for (const item of items) {
    if (!item.topicId) continue;
    let c = byTopic.get(item.topicId);
    if (!c) {
      c = { topicId: item.topicId, items: [], tokenCounts: new Map() };
      byTopic.set(item.topicId, c);
      clusters.push(c);
    }
    addItem(c, item, tokensById.get(item.id) ?? [], index);
  }

  // 2) Yeni haberler zaman sırasıyla en benzer kümeye katılır ya da yeni küme açar
  const fresh = items
    .filter((i) => !i.topicId)
    .sort((a, b) => a.at.getTime() - b.at.getTime() || a.id - b.id);
  for (const item of fresh) {
    const tokens = tokensById.get(item.id) ?? [];
    if (tokens.length < MIN_SHARED_TOKENS) continue; // çok kısa başlık gruplanamaz
    let best: Cluster | null = null;
    let bestScore = 0;
    const candidates = new Set<Cluster>();
    for (const t of tokens) for (const c of index.get(t) ?? []) candidates.add(c);
    for (const c of candidates) {
      const score = similarity(tokens, coreTokens(c), idf);
      if (score > bestScore) {
        best = c;
        bestScore = score;
      }
    }
    if (best && bestScore >= SIMILARITY_THRESHOLD) addItem(best, item, tokens, index);
    else {
      const c: Cluster = { topicId: null, items: [], tokenCounts: new Map() };
      addItem(c, item, tokens, index);
      clusters.push(c);
    }
  }
  return clusters;
}

/** Kümeyi en iyi temsil eden başlık: çekirdeğe en benzer, eşitlikte en eski */
export function representative(cluster: Cluster): ClusterInput {
  const core = coreTokens(cluster);
  let best = cluster.items[0]!;
  let bestScore = -1;
  for (const item of cluster.items) {
    const tokens = tokenize(item.title);
    const shared = tokens.filter((t) => core.has(t)).length;
    const score = tokens.length ? shared / tokens.length + shared * 0.01 : 0;
    if (score > bestScore || (score === bestScore && item.at < best.at)) {
      best = item;
      bestScore = score;
    }
  }
  return best;
}

export function distinctPublishers(items: ClusterInput[]): number {
  return new Set(items.map((i) => i.publisherId ?? -1)).size;
}
