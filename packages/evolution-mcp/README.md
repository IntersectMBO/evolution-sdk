# Evolution MCP

`@evolution-sdk/mcp` exposes Evolution SDK functionality as an MCP server with both HTTP and stdio transports.

Default runtime configuration (HTTP mode):

- Host: `127.0.0.1`
- Port: `10000`
- MCP endpoint: `/mcp`
- Health endpoint: `/health`

The package ships a Linux-first `postinstall` bootstrap that attempts to register and start a local background process so the server is reachable at `http://localhost:10000/mcp` after installation. If automatic startup cannot be completed, installation stays successful and the package prints a manual fallback.

## Commands

```bash
pnpm --filter @evolution-sdk/mcp build
pnpm --filter @evolution-sdk/mcp test

# HTTP server (default)
node packages/evolution-mcp/dist/bin.js serve

# Stdio transport (for MCP clients that spawn the process)
node packages/evolution-mcp/dist/bin.js stdio
```

## Environment Variables

- `EVOLUTION_MCP_HOST`: bind host, default `127.0.0.1`
- `EVOLUTION_MCP_PORT`: bind port, default `10000`
- `EVOLUTION_MCP_PATH`: MCP route, default `/mcp`
- `EVOLUTION_MCP_HEALTH_PATH`: health route, default `/health`
- `EVOLUTION_MCP_SKIP_POSTINSTALL`: skip install-time bootstrap when set to `1`
- `EVOLUTION_MCP_POSTINSTALL_STRICT`: fail install if bootstrap fails when set to `1`

## Tool Surface (66 tools)

| Category | Count | Tools |
|----------|-------|-------|
| Meta / Introspection | 3 | `sdk_info`, `sdk_exports`, `destroy_handle` |
| Codecs & Encoding | 8 | `address_codec`, `assets_codec`, `cbor_codec`, `data_codec`, `identifier_codec`, `typed_export_codec`, `encoding_codec`, `plutus_data_codec_tools` |
| Workflow | 7 | `create_client`, `client_attach`, `client_invoke`, `tx_builder_create`, `tx_builder_apply`, `tx_builder_build`, `result_call` |
| Cryptography | 5 | `key_generate`, `bip32_key_tools`, `message_sign`, `message_verify`, `ed25519_signature_tools` |
| Governance & Certificates | 10 | `anchor_tools`, `certificate_tools`, `voting_tools`, `governance_action_tools`, `proposal_tools`, `drep_tools`, `drep_cert_tools`, `committee_cert_tools`, `constitution_tools`, `protocol_param_update_tools` |
| Transaction Primitives | 9 | `transaction_input_tools`, `transaction_body_tools`, `tx_output_tools`, `mint_tools`, `withdrawals_tools`, `redeemer_tools`, `redeemers_collection_tools`, `proposal_procedures_collection_tools`, `script_ref_tools` |
| Value & Assets | 5 | `value_tools`, `assets_tools`, `unit_tools`, `coin_tools`, `plutus_value_tools` |
| Scripts | 4 | `native_script_tools`, `script_tools`, `uplc_tools`, `evaluator_info` |
| Address Types | 3 | `address_build`, `pointer_address_tools`, `byron_address_tools` |
| Data & Hashing | 2 | `data_construct`, `hash_tools` |
| Blueprints | 2 | `blueprint_parse`, `blueprint_codegen` |
| Network & Time | 2 | `network_tools`, `time_slot_convert` |
| Metadata & Credentials | 2 | `metadata_tools`, `credential_tools` |
| Other | 3 | `utxo_tools`, `pool_params_tools`, `fee_validate` |
| Devnet | 1 | `devnet` |

This package covers all four workspace packages: `@evolution-sdk/evolution`, `@evolution-sdk/aiken-uplc`, `@evolution-sdk/scalus-uplc`, and `@evolution-sdk/devnet`.