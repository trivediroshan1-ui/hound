// Credits a real-money Bones purchase right after the client's own
// purchasePackage() call resolves — the fast, synchronous half of the
// two-path design (see revenuecat-webhook's own comment for the other
// half, which exists as a safety net when this call never happens, e.g.
// the app is killed right after purchase).
//
// A client claiming "I just bought bones_pack_medium, transaction abc123"
// is never trusted on its own — same "server re-derives, never trusts
// the client" rule purchase_cosmetic (0060_bones_shop.sql) already
// follows. This function re-checks the transaction against RevenueCat's
// own subscriber record before crediting anything, so a made-up
// transaction id can't get free Bones.
//
// credit_bones_purchase itself is idempotent (0064_bones_purchases.sql's
// unique (store, transaction_id) constraint), so this racing with
// revenuecat-webhook processing the same purchase is harmless — whichever
// arrives first credits it, the other is a no-op.
//
// Deploy with the Supabase CLI:
//   supabase functions deploy sync-purchase
// Requires the REVENUECAT_SECRET_API_KEY function secret (RevenueCat
// dashboard: Project Settings > API Keys > Secret API key — never the
// public SDK key, which has no access to the subscriber-verification
// endpoint used below).

import { createClient } from 'jsr:@supabase/supabase-js@2';

// Only Hound's own website may call this from a browser. The app is not a
// browser, so it is unaffected. For local web testing, set the
// HOUND_WEB_ORIGIN secret (for example http://localhost:8081) on staging.
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': Deno.env.get('HOUND_WEB_ORIGIN') ?? 'https://houndchallenge.net',
  Vary: 'Origin',
  'Access-Control-Allow-Headers': 'authorization, content-type',
};

function jsonError(message: string, status: number) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
}

interface SyncBody {
  productId?: string;
  transactionId?: string;
  store?: string;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS_HEADERS });

  try {
    const { productId, transactionId, store } = (await req.json()) as SyncBody;
    if (
      typeof productId !== 'string' ||
      !productId ||
      typeof transactionId !== 'string' ||
      !transactionId ||
      (store !== 'app_store' && store !== 'play_store')
    ) {
      return jsonError('productId, transactionId and a valid store are required.', 400);
    }

    const callerClient = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
      global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } },
    });
    const {
      data: { user: caller },
    } = await callerClient.auth.getUser();
    if (!caller) return jsonError('Sign in to do that.', 401);

    // Assumes Purchases.configure({ appUserID: <supabase user id> }) on
    // the client (Phase A/C setup) — RevenueCat's own anonymous id would
    // never line up with a real profile here.
    //
    // Retried with backoff rather than checked once: this runs seconds
    // (sometimes less) after the on-device purchase completes, and
    // RevenueCat's own backend has been observed to take a few seconds
    // to sync a brand-new transaction into the subscriber record this
    // endpoint serves — a single immediate check can genuinely lose that
    // race even though the purchase is completely real. revenuecat-webhook
    // is the safety net for a real failure; retrying here just avoids
    // treating that ordinary propagation lag as one.
    const delaysMs = [1000, 2000, 3000];
    let matched = false;
    let verifiedStore: 'app_store' | 'play_store' = store;
    let verifiedTransactionId = transactionId;
    for (let attempt = 0; attempt <= delaysMs.length; attempt++) {
      const verifyRes = await fetch(`https://api.revenuecat.com/v1/subscribers/${encodeURIComponent(caller.id)}`, {
        signal: AbortSignal.timeout(8000),
        headers: { Authorization: `Bearer ${Deno.env.get('REVENUECAT_SECRET_API_KEY')}` },
      });
      if (!verifyRes.ok) {
        return jsonError('Could not verify this purchase with RevenueCat right now.', 502);
      }

      // Shape per RevenueCat's REST API "non-subscription purchases" docs
      // as of when this was written — re-check subscriber.non_subscriptions'
      // exact shape against current docs before relying on this in
      // production, since third-party API surfaces move.
      const payload = await verifyRes.json();
      const records: Array<{ id?: string; store?: string; store_transaction_id?: string }> =
        payload?.subscriber?.non_subscriptions?.[productId] ?? [];
      const record = records.find((r) => r.id === transactionId || r.store_transaction_id === transactionId);
      matched = record !== undefined;
      if (record) {
        // Use the store RevenueCat recorded for this purchase, not the one
        // the phone claims. Otherwise the same purchase can be credited
        // once as app_store and once as play_store.
        const rcStore = record.store === 'app_store' || record.store === 'play_store' ? record.store : null;
        if (rcStore) verifiedStore = rcStore;
        // Credit under the store's own transaction id when RevenueCat gives
        // one, so this path and the webhook agree on a single key.
        if (record.store_transaction_id) verifiedTransactionId = record.store_transaction_id;
      }
      if (matched) break;
      if (attempt < delaysMs.length) await new Promise((resolve) => setTimeout(resolve, delaysMs[attempt]));
    }
    if (!matched) {
      return jsonError('That purchase could not be verified for this account.', 403);
    }

    const adminClient = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    const { error } = await adminClient.rpc('credit_bones_purchase', {
      p_user_id: caller.id,
      p_store: verifiedStore,
      p_product_id: productId,
      p_transaction_id: verifiedTransactionId,
    });
    if (error) return jsonError(error.message, 400);

    return new Response(JSON.stringify({ credited: true }), {
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    });
  } catch (e) {
    console.error('sync-purchase failed', e);
    return jsonError('Unexpected error.', 500);
  }
});
