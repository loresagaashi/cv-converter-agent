import type { CV, User } from "@/lib/types";
import type {
  CompetencePaperWithCV,
  ConversationCompetencePaperWithCV,
} from "@/lib/api";

type DashboardListCache = {
  cvs: CV[] | null;
  competencePapers: CompetencePaperWithCV[] | null;
  conversationPapers: ConversationCompetencePaperWithCV[] | null;
  users: User[] | null;
};

const cache: DashboardListCache = {
  cvs: null,
  competencePapers: null,
  conversationPapers: null,
  users: null,
};

export function getCachedCVs() {
  return cache.cvs;
}

export function setCachedCVs(items: CV[]) {
  cache.cvs = items;
}

export function getCachedCompetencePapers() {
  return cache.competencePapers;
}

export function setCachedCompetencePapers(items: CompetencePaperWithCV[]) {
  cache.competencePapers = items;
}

export function getCachedConversationPapers() {
  return cache.conversationPapers;
}

export function setCachedConversationPapers(items: ConversationCompetencePaperWithCV[]) {
  cache.conversationPapers = items;
}

export function getCachedUsers() {
  return cache.users;
}

export function setCachedUsers(items: User[]) {
  cache.users = items;
}
