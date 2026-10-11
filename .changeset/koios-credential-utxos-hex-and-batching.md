---
"@evolution-sdk/evolution": patch
---

`getUtxosByPaymentCredential(s)` sends the credential as hex, and splits a long list by body size.

A `Credential`'s `hash` is a `Uint8Array`, and the request body was built from it directly — so `JSON.stringify` wrote `{"0":170,"1":170,…}` where Koios expects `"aaaa…"`. The query could not have worked for any real credential. The tests that covered it built their credentials by hand as `{_tag: "KeyHash", hash} as never`, which put a *string* in the fixture: the only thing that ever matched the code was the test.

Koios also refuses a request body over 5120 bytes with a 413, and a wallet asking about its whole signable set passes that at around 90 credentials — measured, 664 of them come to 39,219 bytes in one body. The list is now chunked by serialized length, in order, the way the DRep and pool id lists already were.
