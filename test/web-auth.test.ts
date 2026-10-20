import assert from "node:assert/strict";
import { test } from "node:test";
import { Auth } from "../src/web/auth.js";

test("demo device slots keep identities and sign-out separate", async () => {
  const values = new Map<string, string>();
  const storage = { getItem: (k: string) => values.get(k) ?? null, setItem: (k: string, v: string) => values.set(k, v), removeItem: (k: string) => values.delete(k) };
  const prior = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  Object.defineProperty(globalThis, "localStorage", { value: storage, configurable: true });
  try {
    const seller = new Auth({ auth: "none" }, "seller");
    const buyer = new Auth({ auth: "none" }, "buyer");
    seller.signInLocally("Sam");
    buyer.signInLocally("Mei");
    assert.equal((await new Auth({ auth: "none" }, "seller").headers())["X-User-Id"], "u_sam");
    assert.equal((await new Auth({ auth: "none" }, "buyer").headers())["X-User-Id"], "u_mei");
    seller.signOut();
    assert.equal(new Auth({ auth: "none" }, "seller").signedIn, false);
    assert.equal(new Auth({ auth: "none" }, "buyer").signedIn, true);
    assert.equal(new Auth({ auth: "none" }).signedIn, false);
  } finally {
    if (prior) Object.defineProperty(globalThis, "localStorage", prior);
    else Reflect.deleteProperty(globalThis, "localStorage");
  }
});
