// Passkey (WebAuthn) helpers: base64url <-> ArrayBuffer and credential JSON.
import { api } from './api.js'

function b64urlToBuf(value) {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/')
  const pad = padded.length % 4 ? '='.repeat(4 - (padded.length % 4)) : ''
  const binary = atob(padded + pad)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes.buffer
}

function bufToB64url(buffer) {
  if (!buffer) return null
  const bytes = new Uint8Array(buffer)
  let binary = ''
  for (const b of bytes) binary += String.fromCharCode(b)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function credentialToJSON(cred) {
  const response = {}
  const r = cred.response
  for (const key of [
    'clientDataJSON',
    'attestationObject',
    'authenticatorData',
    'signature',
    'userHandle',
  ]) {
    if (r[key]) response[key] = bufToB64url(r[key])
  }
  return {
    id: cred.id,
    rawId: bufToB64url(cred.rawId),
    type: cred.type,
    response,
    clientExtensionResults: cred.getClientExtensionResults ? cred.getClientExtensionResults() : {},
  }
}

export function passkeysSupported() {
  return typeof window !== 'undefined' && !!window.PublicKeyCredential
}

export async function registerPasskey(setupToken) {
  const begin = await api.authRegisterBegin(setupToken)
  const publicKey = begin.options.publicKey
  publicKey.challenge = b64urlToBuf(publicKey.challenge)
  publicKey.user.id = b64urlToBuf(publicKey.user.id)
  publicKey.excludeCredentials = (publicKey.excludeCredentials || []).map((c) => ({
    ...c,
    id: b64urlToBuf(c.id),
  }))
  const cred = await navigator.credentials.create({ publicKey })
  return api.authRegisterComplete({
    ceremony: begin.ceremony,
    setup_token: setupToken,
    credential: credentialToJSON(cred),
  })
}

export async function loginWithPasskey() {
  const begin = await api.authLoginBegin()
  const publicKey = begin.options.publicKey
  publicKey.challenge = b64urlToBuf(publicKey.challenge)
  publicKey.allowCredentials = (publicKey.allowCredentials || []).map((c) => ({
    ...c,
    id: b64urlToBuf(c.id),
  }))
  const cred = await navigator.credentials.get({ publicKey })
  return api.authLoginComplete({
    ceremony: begin.ceremony,
    credential: credentialToJSON(cred),
  })
}
