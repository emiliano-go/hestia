"""Providers: presets, CRUD, model listing, test-connection.

Keys may be stored on the provider row (from the UI) or read from an env var;
the stored key is never returned to the client.
"""

from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import Session, select

from home.providers.base import OpenAIClient, list_models, resolve_api_key
from home.providers.catalog import PRESETS
from home.registry.db import session
from home.registry.models import Provider

router = APIRouter(prefix="/api/providers", tags=["providers"])


def _public(provider: Provider) -> dict:
    return {
        "id": provider.id,
        "name": provider.name,
        "base_url": provider.base_url,
        "api_key_env": provider.api_key_env,
        "model": provider.model,
        "has_key": bool(provider.api_key),
        "created_at": provider.created_at,
    }


@router.get("/presets")
def list_presets():
    return PRESETS


@router.get("")
def list_providers(s: Session = Depends(session)):
    return [_public(p) for p in s.exec(select(Provider)).all()]


@router.post("", status_code=201)
def create_provider(body: dict, s: Session = Depends(session)):
    name = (body.get("name") or "").strip()
    base_url = (body.get("base_url") or "").strip()
    if not name or not base_url:
        raise HTTPException(400, "name and base_url are required")
    provider = Provider(
        name=name,
        base_url=base_url.rstrip("/"),
        api_key_env=(body.get("api_key_env") or "").strip(),
        api_key=(body.get("api_key") or "").strip() or None,
        model=(body.get("model") or "").strip(),
    )
    s.add(provider)
    s.commit()
    s.refresh(provider)
    return _public(provider)


@router.delete("/{provider_id}", status_code=204)
def delete_provider(provider_id: int, s: Session = Depends(session)):
    provider = s.get(Provider, provider_id)
    if not provider:
        raise HTTPException(404, "provider not found")
    s.delete(provider)
    s.commit()


@router.post("/models")
async def provider_models(body: dict, s: Session = Depends(session)):
    """List models for a base_url + key, or for a saved provider."""
    base_url = (body.get("base_url") or "").strip()
    api_key = (body.get("api_key") or "").strip()
    if not api_key and body.get("api_key_env"):
        import os

        api_key = os.environ.get(str(body["api_key_env"]).strip()) or ""
    if body.get("provider_id"):
        provider = s.get(Provider, int(body["provider_id"]))
        if not provider:
            raise HTTPException(404, "provider not found")
        base_url = base_url or provider.base_url
        api_key = api_key or resolve_api_key(provider) or ""
    if not base_url:
        raise HTTPException(400, "base_url is required")
    try:
        models = await list_models(base_url, api_key or None)
    except Exception as e:
        raise HTTPException(502, f"could not load models: {str(e)[:200]}")
    return {"models": models}


@router.post("/{provider_id}/test")
async def test_provider(provider_id: int, s: Session = Depends(session)):
    provider = s.get(Provider, provider_id)
    if not provider:
        raise HTTPException(404, "provider not found")
    client = OpenAIClient(provider.base_url, resolve_api_key(provider), provider.model)
    try:
        chunk = await client.test_connection()
        return {"ok": True, "model": chunk.get("model")}
    except Exception as e:
        return {"ok": False, "error": str(e)[:500]}
