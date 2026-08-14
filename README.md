# ContextSlim TypeScript SDK

> **High-performance M2M context middleware and x402 micropayment engine for AI Agents and MCP tools on Base.**

ContextSlim prunes massive JSON payloads by up to **85%**, enforces strict token budgets, and handles autonomous HTTP 402 EIP-712 micropayments—keeping agent execution fast, cost-effective, and deterministically within LLM context limits.

[![smithery badge](https://smithery.ai/badge/friczero-com/contextslim)](https://smithery.ai/servers/friczero-com/contextslim)

---

## Proven E2E Benchmarks

Real-world test suite performance measured over live execution on Cloudflare KV + Base Sepolia:

| MCP Tool / Operation | Input Payload | Output Payload | Reduction / Impact | Performance Metric |
| --- | --- | --- | --- | --- |
| **`optimize_context`** | 622 Tokens | **94 Tokens** | **84.9% Token Saved** | 528 Tokens saved in array pruning |
| **`fetch_result` (Targeted Path)** | 622 Tokens | **9 Tokens** | **98.5% Savings** | Instant extraction via JSONPath |
| **Session Pass (2nd Query)** | On-chain Auth | Cache Auth | **70% Latency Drop** | **0.43s $\rightarrow$ 0.13s** execution speed |

---

## Architecture & Protocol Flow

ContextSlim seamlessly sits between your AI Agent framework, the Model Context Protocol (MCP), and the Base blockchain:

```
+-------------------+       1. MCP Tool Call       +------------------------+
|  AI Agent / LLM   | ---------------------------> |  @contextslim/sdk      |
| (Claude / Cursor) | <--------------------------- |  (TS Engine Client)    |
+-------------------+     4. Pruned Payload        +------------------------+
                                                               |        ^
                                             2. x402 Payment   |        | 3. Optimized Data
                                                Challenge/Pass |        |    & Reference ID
                                                               v        |
                                                   +--------------------------------+
                                                   | ContextSlim Worker Engine      |
                                                   | (Cloudflare KV + Pruner Engine)|
                                                   +--------------------------------+
                                                                   |
                                                                   v (On-Chain Settlement)
                                                   +--------------------------------+
                                                   | Base Network (USDC / ERC-3009) |
                                                   +--------------------------------+
```

---

## Installation

Install the agnostic SDK optimized for Node.js (v18+), Bun, Deno, and Cloudflare Workers:

```bash
npm install @contextslim/sdk ethers dotenv
```

---

## MCP Client Configurations

### 1. Claude Desktop Integration

Add the following configuration to your `claude_desktop_config.json` file:

```json
{
  "mcpServers": {
    "contextslim": {
      "command": "npx",
      "args": ["-y", "@contextslim/sdk"],
      "env": {
        "ENDPOINT_URL": "https://contextslim.friczero.com",
        "PRIVATE_KEY": "0x_YOUR_AGENT_PRIVATE_KEY"
      }
    }
  }
}
```

### 2. Cursor IDE (`.cursor/mcp.json`)

```json
{
  "mcpServers": {
    "contextslim": {
      "url": "https://contextslim.friczero.com/message"
    }
  }
}
```

### 3. Smithery CLI

One-click installation via Smithery:

```bash
npx -y @smithery/cli install contextslim --client claude
```

---

## 30-Second Quickstart

This script initializes the client with an active **Session Pass** ($0.005 USDC), prunes a massive JSON payload, and retrieves specific fields with ultra-low latency:

```typescript
import { ContextSlimClient } from "@contextslim/sdk";
import { Wallet } from "ethers";
import * as dotenv from "dotenv";

dotenv.config();

async function main() {
  // 1. Initialize Local Signer (Private key isolated in memory)
  const wallet = new Wallet(process.env.PRIVATE_KEY!);

  // 2. Instantiate ContextSlim Client
  const client = new ContextSlimClient({
    endpoint: process.env.ENDPOINT_URL || "https://contextslim.friczero.com",
    signer: wallet,
    allowanceBudget: 0.005, // Optional: Enables Session Pass to avoid signing every query
    maxTokenBudget: 1000,
  });

  // 3. Prune Massive Payload (optimize_context)
  const heavyPayload = {
    critical_alert: {
      severity: "CRITICAL",
      system: "database-cluster-primary",
      message: "Connection pool exhausted on port 5432",
    },
    system_status: { cpu_load: "88%", memory_used: "14.2GB" },
    logs: Array.from({ length: 100 }, (_, i) => `Log entry #${i + 1}: Activity sweep`),
  };

  console.log("Optimizing massive context...");
  const prep = await client.callTool("optimize_context", {
    data: heavyPayload,
    maxTokenBudget: 150,
  });

  const res = prep.result || {};
  const refId = res.toolResultReference?.referenceId || res.referenceId;
  console.log(`Reference Cached in KV: ${refId}`);
  console.log(`Saved Tokens: ${prep.metrics?.savedTokens}`);
  console.log(`Compression Ratio: ${prep.metrics?.reductionPercentage}`);

  // 4. Targeted Path Extraction (fetch_result)
  console.log("Retrieving only 'critical_alert.severity'...");
  const extracted = await client.callTool("fetch_result", {
    referenceId: refId,
    paths: ["critical_alert.severity"],
  });

  console.log("Result:", JSON.stringify(extracted?.result ?? {}, null, 2));
  // Returns only 9 tokens: { critical_alert: { severity: 'CRITICAL' } }
}

main().catch(console.error);
```

---

## Advanced Signer Setup (Production & Enterprise)

While passing a raw `ethers.Wallet` initialized from an environment variable works for local development, production AI agents should avoid storing plain-text private keys in `.env` files.

`ContextSlimClient` accepts any standard `ethers.Signer` interface, allowing seamless integration with Hardware Security Modules (HSMs), Cloud Key Management Services (KMS), and Multi-Party Computation (MPC) infrastructure:

### 1. AWS KMS / Cloud HSM

Keep keys non-exportable inside dedicated cloud HSMs:

```typescript
import { KmsSigner } from "aws-kms-ethers-signer";
import { ContextSlimClient } from "@contextslim/sdk";

const kmsSigner = new KmsSigner({
  keyId: "arn:aws:kms:us-east-1:123456789012:key/your-agent-key-id",
});

const client = new ContextSlimClient({
  endpoint: "https://contextslim.friczero.com",
  signer: kmsSigner, // Native Ethers Signer wrapping AWS KMS
});
```

### 2. Turnkey / Non-Custodial MPC Wallets

Isolate credentials for serverless agents or multi-tenant agent architectures:

```typescript
import { TurnkeySigner } from "@turnkey/ethers";
import { ContextSlimClient } from "@contextslim/sdk";

const turnkeySigner = new TurnkeySigner({
  client: turnkeyClient,
  organizationId: process.env.TURNKEY_ORGANIZATION_ID!,
  signWith: process.env.TURNKEY_WALLET_ADDRESS!,
});

const client = new ContextSlimClient({
  endpoint: "https://contextslim.friczero.com",
  signer: turnkeySigner,
});
```

---

## API Reference

### `new ContextSlimClient(options)`

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `endpoint` | `string` | **Required** | Base URL of the ContextSlim Worker (`https://contextslim.friczero.com`). |
| `signer` | `ethers.Signer` | **Required** | Ethers Signer implementation for ERC-3009/EIP-712 payment authorizations. |
| `allowanceBudget` | `number` | `0` | USDC budget to pre-approve a Session Pass (base price: **$0.001 USDC/call**; on-chain settlement triggers at **$0.005 USDC**). |
| `maxTokenBudget` | `number` | `1000` | Default response token limit. |

---

### `client.callTool(name, params)`

Unified invocation compatible with MCP JSON-RPC.

#### 1. `optimize_context` Tool

Reduces complex JSON structures while preserving critical fields and inserting truncated reference markers (`_slim`).

* **Parameters:**
  * `data` (`object`, required) - Full JSON payload to optimize.
  * `maxTokenBudget` (`number`, optional) - Hard token limit for the response payload.

* **Response:**

```typescript
{
  status: "success",
  result: {
    toolResultReference: { referenceId: "ref_ef17a253", expiresIn: "3600s" },
    // ... pruned payload
  },
  metrics: {
    savedTokens: "528",
    reductionPercentage: "84.9%",
    strategy: "recursive:arrays(47_items)"
  }
}
```

#### 2. `fetch_result` Tool

Retrieves exact data subsets from a cached reference ID.

* **Parameters:**
  * `referenceId` (`string`, required) - ID returned by `optimize_context`.
  * `paths` (`string[]`, optional) - Dot-notation field paths to extract (e.g., `["user.id", "items[0].price"]`).

* **Response:**

```typescript
{
  status: "success",
  referenceId: "ref_ef17a253",
  retrievedTokens: 9,
  result: { critical_alert: { severity: "CRITICAL" } }
}
```

---

## Security & Resilience

* **Cryptographic Isolation:** EIP-712 / ERC-3009 x402 payment challenge signing happens strictly within your local process or designated KMS signer. No private keys or seed phrases ever leave your execution environment.
* **Anti-Replay Protection:** Every payment challenge issued by the HTTP 402 server includes time-bound single-use nonces. Reusing `X-PAYMENT` headers is strictly rejected.
* **Session Pass Mechanism:** Setting an `allowanceBudget` issues an encrypted session pass, amortizing on-chain verification and speeding up subsequent KV fetches to an average execution speed of **0.13 seconds**.

---

## License

This project is licensed under the [MIT License](LICENSE).
