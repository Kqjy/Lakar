import { createHash, randomBytes } from "node:crypto";
import { stmts } from "./db.js";

const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const PREFIX = "LKR";
const CODE_CHARS = 16;
const GROUP = 4;
const DAY_MS = 24 * 60 * 60 * 1000;

export const invitesRequired = () => process.env.LAKAR_INVITES === "required";

export const generateInviteCode = () => {
  const bytes = randomBytes(CODE_CHARS);
  let raw = "";
  for (const byte of bytes) raw += ALPHABET[byte & 31];
  const groups = raw.match(new RegExp(`.{1,${GROUP}}`, "g")) ?? [raw];
  return [PREFIX, ...groups].join("-");
};

export const normalizeInviteCode = (input) => {
  const stripped = String(input ?? "")
    .toUpperCase()
    .replace(/[^A-Z2-9]/g, "");
  if (
    stripped.length === PREFIX.length + CODE_CHARS &&
    stripped.startsWith(PREFIX)
  ) {
    return stripped.slice(PREFIX.length);
  }
  return stripped;
};

const hashOf = (normalized) =>
  createHash("sha256").update(normalized).digest("hex");

const lookup = (code, now) => {
  const normalized = normalizeInviteCode(code);
  if (normalized.length !== CODE_CHARS) return null;
  if (![...normalized].every((ch) => ALPHABET.includes(ch))) return null;
  const row = stmts.inviteByHash.get(hashOf(normalized));
  if (!row || row.usedBy) return null;
  if (row.expiresAt != null && row.expiresAt <= now) return null;
  return row;
};

export const inviteIsOpen = (code, now = Date.now()) => !!lookup(code, now);

export const claimInvite = (code, userId, now = Date.now()) => {
  const row = lookup(code, now);
  if (!row) return false;
  return Number(stmts.useInvite.run(userId, now, row.codeHash).changes) === 1;
};

export const createInvite = (days = null, now = Date.now()) => {
  const code = generateInviteCode();
  const expiresAt = days == null ? null : now + days * DAY_MS;
  stmts.createInvite.run(hashOf(normalizeInviteCode(code)), now, expiresAt);
  return { code, createdAt: now, expiresAt };
};

export const listInvites = () => stmts.listInvites.all();
