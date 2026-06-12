import { RecentlyViewed } from '../models/RecentlyViewed.js';
import { SearchHistory } from '../models/SearchHistory.js';
import { logger } from '../utils/logger.js';

const MAX_RECENTLY_VIEWED = 50;
const MAX_SEARCH_HISTORY = 100;

// ─── Recently Viewed ────────────────────────────────────────────────

export async function getRecentlyViewed(userId: string, limit: number = 20) {
  return RecentlyViewed.find({ userId })
    .sort({ viewedAt: -1 })
    .limit(Math.min(limit, MAX_RECENTLY_VIEWED))
    .lean()
    .exec();
}

export async function clearRecentlyViewed(userId: string): Promise<void> {
  await RecentlyViewed.deleteMany({ userId });
  logger.info('Recently viewed cleared', { userId });
}

// ─── Search History ─────────────────────────────────────────────────

export async function getSearchHistory(userId: string, limit: number = 20) {
  return SearchHistory.find({ userId })
    .sort({ searchedAt: -1 })
    .limit(Math.min(limit, MAX_SEARCH_HISTORY))
    .lean()
    .exec();
}

export async function clearSearchHistory(userId: string): Promise<void> {
  await SearchHistory.deleteMany({ userId });
  logger.info('Search history cleared', { userId });
}
