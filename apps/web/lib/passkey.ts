"use client";

/**
 * Thin browser-side WebAuthn helpers.
 *
 * The api ships `PublicKeyCredentialCreationOptions` / `RequestOptions`
 * as JSON, but the browser API needs the binary fields (challenge,
 * userId, allowCredentials[i].id, …) as ArrayBuffers. These two
 * functions handle the base64url ⇆ ArrayBuffer conversion in both
 * directions so the api side just sees clean JSON.
 */

import { api } from "@/lib/api";

function b64urlToBuf(s: string): ArrayBuffer {
  const pad = "=".repeat((4 - (s.length % 4)) % 4);
  const b64 = (s + pad).replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out.buffer;
}

function bufToB64url(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

type RegisterOptions = {
  challenge: string;
  user: { id: string; name: string; displayName: string };
  rp: { id: string; name: string };
  pubKeyCredParams: PublicKeyCredentialParameters[];
  timeout?: number;
  authenticatorSelection?: AuthenticatorSelectionCriteria;
  excludeCredentials?: { type: "public-key"; id: string; transports?: AuthenticatorTransport[] }[];
  attestation?: AttestationConveyancePreference;
};

type AssertOptions = {
  challenge: string;
  rpId: string;
  timeout?: number;
  userVerification?: UserVerificationRequirement;
  allowCredentials?: { type: "public-key"; id: string; transports?: AuthenticatorTransport[] }[];
};

/** Register a new passkey for the current account. UI flow:
 *  1) POST /register/options to mint a challenge
 *  2) call navigator.credentials.create() to prompt the user
 *  3) POST /register/verify with the response (re-encoded as JSON) */
export async function registerPasskey(name?: string): Promise<void> {
  const { options_json } = await api.passkeyRegisterOptions();
  const opts = JSON.parse(options_json) as RegisterOptions;
  const cred = (await navigator.credentials.create({
    publicKey: {
      ...opts,
      challenge: b64urlToBuf(opts.challenge),
      user: { ...opts.user, id: b64urlToBuf(opts.user.id) },
      excludeCredentials: opts.excludeCredentials?.map((c) => ({
        ...c, id: b64urlToBuf(c.id),
      })),
    },
  })) as PublicKeyCredential | null;
  if (!cred) throw new Error("authenticator cancelled");
  const att = cred.response as AuthenticatorAttestationResponse;
  const json = JSON.stringify({
    id: cred.id,
    rawId: bufToB64url(cred.rawId),
    type: cred.type,
    response: {
      attestationObject: bufToB64url(att.attestationObject),
      clientDataJSON: bufToB64url(att.clientDataJSON),
      transports: att.getTransports?.() ?? [],
    },
    clientExtensionResults: cred.getClientExtensionResults(),
  });
  await api.passkeyRegisterVerify(json, name);
}

/** Sign an assertion using a registered passkey. On success the api
 *  drops a short-lived unlock cookie the caller can use within 5 min. */
export async function assertPasskey(): Promise<void> {
  const { options_json } = await api.passkeyAssertOptions();
  const opts = JSON.parse(options_json) as AssertOptions;
  const cred = (await navigator.credentials.get({
    publicKey: {
      ...opts,
      challenge: b64urlToBuf(opts.challenge),
      allowCredentials: opts.allowCredentials?.map((c) => ({
        ...c, id: b64urlToBuf(c.id),
      })),
    },
  })) as PublicKeyCredential | null;
  if (!cred) throw new Error("authenticator cancelled");
  const a = cred.response as AuthenticatorAssertionResponse;
  const json = JSON.stringify({
    id: cred.id,
    rawId: bufToB64url(cred.rawId),
    type: cred.type,
    response: {
      authenticatorData: bufToB64url(a.authenticatorData),
      clientDataJSON: bufToB64url(a.clientDataJSON),
      signature: bufToB64url(a.signature),
      userHandle: a.userHandle ? bufToB64url(a.userHandle) : null,
    },
    clientExtensionResults: cred.getClientExtensionResults(),
  });
  await api.passkeyAssertVerify(json);
}
