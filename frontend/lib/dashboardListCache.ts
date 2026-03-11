import type { CV, User } from "@/lib/types";
import type {
  CompetencePaperWithCV,
  ConversationCompetencePaperWithCV,
} from "@/lib/api";

type PaginatedCacheEntry<T> = {
  items: T[];
  totalPages: number;
  totalRecords: number;
};

type PaginatedSectionCache<T> = Record<string, PaginatedCacheEntry<T>>;

type DashboardListCache = {
  cvs: PaginatedSectionCache<CV>;
  competencePapers: PaginatedSectionCache<CompetencePaperWithCV>;
  conversationPapers: PaginatedSectionCache<ConversationCompetencePaperWithCV>;
  users: PaginatedSectionCache<User>;
};

const cache: DashboardListCache = {
  cvs: {},
  competencePapers: {},
  conversationPapers: {},
  users: {},
};

function getPageKey(page: number, pageSize: number) {
  return `${page}:${pageSize}`;
}

function getPaginatedCache<T>(
  section: PaginatedSectionCache<T>,
  page: number,
  pageSize: number
) {
  return section[getPageKey(page, pageSize)] ?? null;
}

function setPaginatedCache<T>(
  section: PaginatedSectionCache<T>,
  page: number,
  pageSize: number,
  entry: PaginatedCacheEntry<T>
) {
  section[getPageKey(page, pageSize)] = entry;
}

function clearPaginatedCache<T>(section: PaginatedSectionCache<T>) {
  Object.keys(section).forEach((key) => {
    delete section[key];
  });
}

export function getCachedCVs(page: number, pageSize: number) {
  return getPaginatedCache(cache.cvs, page, pageSize);
}

export function setCachedCVs(
  page: number,
  pageSize: number,
  entry: PaginatedCacheEntry<CV>
) {
  setPaginatedCache(cache.cvs, page, pageSize, entry);
}

export function clearCachedCVs() {
  clearPaginatedCache(cache.cvs);
}

export function getCachedCompetencePapers(page: number, pageSize: number) {
  return getPaginatedCache(cache.competencePapers, page, pageSize);
}

export function setCachedCompetencePapers(
  page: number,
  pageSize: number,
  entry: PaginatedCacheEntry<CompetencePaperWithCV>
) {
  setPaginatedCache(cache.competencePapers, page, pageSize, entry);
}

export function clearCachedCompetencePapers() {
  clearPaginatedCache(cache.competencePapers);
}

export function getCachedConversationPapers(page: number, pageSize: number) {
  return getPaginatedCache(cache.conversationPapers, page, pageSize);
}

export function setCachedConversationPapers(
  page: number,
  pageSize: number,
  entry: PaginatedCacheEntry<ConversationCompetencePaperWithCV>
) {
  setPaginatedCache(cache.conversationPapers, page, pageSize, entry);
}

export function clearCachedConversationPapers() {
  clearPaginatedCache(cache.conversationPapers);
}

export function getCachedUsers(page: number, pageSize: number) {
  return getPaginatedCache(cache.users, page, pageSize);
}

export function setCachedUsers(
  page: number,
  pageSize: number,
  entry: PaginatedCacheEntry<User>
) {
  setPaginatedCache(cache.users, page, pageSize, entry);
}

export function clearCachedUsers() {
  clearPaginatedCache(cache.users);
}
