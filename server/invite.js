import { db } from "./db.js";
import { createInvite, listInvites } from "./invites.js";

const args = process.argv.slice(2);

const die = (message) => {
  console.error(message);
  db.close();
  process.exit(1);
};

const readDays = () => {
  const inline = args.find((a) => a.startsWith("--days="));
  const index = args.indexOf("--days");
  if (!inline && index === -1) return null;
  const raw = inline ? inline.slice("--days=".length) : args[index + 1];
  const days = Number(raw);
  if (!raw || !Number.isInteger(days)) {
    die("Usage: node invite.js [--days N] [--list]");
  }
  return days;
};

const day = (ms) =>
  ms == null ? "never" : new Date(ms).toISOString().slice(0, 10);

const state = (row) => {
  if (row.usedAt) return `used by ${row.usedByEmail ?? "a deleted account"}`;
  if (row.expiresAt != null && row.expiresAt <= Date.now()) {
    return "unused (expired)";
  }
  return "unused";
};

const list = () => {
  const rows = listInvites();
  if (!rows.length) {
    console.log("No invite codes yet — run `npm run invite` to make one.");
    return;
  }
  for (const row of rows) {
    console.log(
      `${row.codeHash.slice(0, 8)}  created ${day(row.createdAt)}  expires ${day(
        row.expiresAt,
      )}  ${state(row)}`,
    );
  }
};

const create = () => {
  const { code, expiresAt } = createInvite(readDays());
  const origin = process.env.LAKAR_ORIGIN || "https://your-lakar-host";
  console.log(code);
  console.log(
    expiresAt == null
      ? "Never expires, good for one sign-up."
      : `Expires ${day(expiresAt)}, good for one sign-up.`,
  );
  console.log(`Sign-up link: ${origin}/#invite=${code}`);
};

if (args.includes("--list")) list();
else create();

db.close();
