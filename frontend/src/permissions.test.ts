import { describe, it, expect } from "vitest";
import { canAccess, permissionsFor, reconcileSession } from "./permissions";
import type { Session } from "./types";

const session:Session={username:"operator",mode:"simulated",units:[{id:1,slug:"ame",name:"AME",paused:true,response_hours:24}],roles:{ame:"operator"},permissions:{ame:{appointments:"write",groups:"read",messages:"none"}}};
describe("Explicit sidebar grants",()=>{
  it("shows only selected sections and preserves read-only groups",()=>{
    expect(canAccess(session,"ame","appointments",true)).toBe(true);
    expect(canAccess(session,"ame","groups")).toBe(true);
    expect(canAccess(session,"ame","groups",true)).toBe(false);
    expect(canAccess(session,"ame","messages")).toBe(false);
    expect(canAccess(session,"ame","users")).toBe(false);
  });
  it("rejects withdrawn units even when a cached role exists",()=>{
    expect(canAccess({...session,units:[]},"ame","appointments")).toBe(false);
    expect(Object.values(permissionsFor(session,"other")).every(x=>x==="none")).toBe(true);
  });
});

describe("Session polling", () => {
  it("keeps the same session when polling returns unchanged data", () => {
    expect(reconcileSession(session, JSON.parse(JSON.stringify(session)))).toBe(session);
  });
  it("applies changed permissions immediately", () => {
    const next = {...session, permissions: {ame: {...session.permissions?.ame, appointments: "none" as const}}};
    const result = reconcileSession(session, next);
    expect(result).toBe(next);
    expect(canAccess(result, "ame", "appointments")).toBe(false);
  });
  it("applies revoked units", () => {
    const next = {...session, units: []};
    expect(reconcileSession(session, next)).toBe(next);
    expect(canAccess(reconcileSession(session, next), "ame", "appointments")).toBe(false);
  });
  it("applies changes to the send mode", () => {
    const next = {...session, mode: "meta_test"};
    expect(reconcileSession(session, next)).toBe(next);
  });
});
