/** /invite: a fresh link only for verified, qualifying members who are not already in the group. */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { enforceMember, resendInvites } from "../src/services/enforcement.js";
import { ensureMember } from "../src/services/verification.js";
import { account, bind, dbAvailable, makeCtx, markJoined } from "./helpers.js";

const available = await dbAvailable();

describe.skipIf(!available)("/invite", () => {
  let t: Awaited<ReturnType<typeof makeCtx>>;
  beforeAll(async () => { t = await makeCtx(); });
  afterAll(async () => { await t?.cleanup(); });

  it("refuses unverified users", async () => {
    await ensureMember(t.ctx, 4001);
    expect((await resendInvites(t.ctx, 4001)).outcome).toBe("unverified");
    expect((await resendInvites(t.ctx, 9999)).outcome).toBe("unverified");
  });

  it("sends a new link when the member is not in the group, and revokes the old one", async () => {
    t.reader.set(account(1).address, "1200");
    await bind(t.ctx, 4002, 1);
    await enforceMember(t.ctx, 4002, "verify");
    const first = t.tg.invites.length;
    const r = await resendInvites(t.ctx, 4002);
    expect(r.outcome).toBe("sent");
    expect(t.tg.invites.length).toBe(first + 1);
    const open = (await t.pool.query("SELECT 1 FROM group_memberships WHERE telegram_id=4002 AND removed_at IS NULL")).rowCount;
    expect(open).toBe(1);
  });

  it("refuses when Telegram says they're already in the group", async () => {
    await markJoined(t.ctx, 4002, "-100low");
    t.tg.inGroup.add("-100low:4002");
    const before = t.tg.invites.length;
    const r = await resendInvites(t.ctx, 4002);
    expect(r.outcome).toBe("already_in");
    expect(t.tg.invites.length).toBe(before);
  });

  it("re-issues if our record says joined but they actually left", async () => {
    t.tg.inGroup.delete("-100low:4002");
    const r = await resendInvites(t.ctx, 4002);
    expect(r.outcome).toBe("sent");
  });

  it("refuses members who no longer qualify", async () => {
    t.reader.set(account(2).address, "1200");
    await bind(t.ctx, 4003, 2);
    t.reader.set(account(2).address, "5");
    expect((await resendInvites(t.ctx, 4003)).outcome).toBe("not_eligible");
  });
});
