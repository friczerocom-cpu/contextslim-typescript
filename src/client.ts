// src/client.ts

export interface ClientConfig {
  endpoint: string;
  /** Ethers.js (v5 or v6) signer, Viem wallet client, or any EIP-712 compatible signer */
  signer: any;
  maxTokenBudget?: number;
  allowanceBudget?: number; // e.g., 0.005 USDC for session pass
}

export interface CallToolResult {
  result: any;
  metrics?: {
    savedTokens: string | null;
    compressionRatio: string | null;
    strategy: string | null;
  };
}

const USDC_ADDRESSES: Record<string, string> = {
  sepolia: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
  mainnet: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
};

export class ContextSlimClient {
  private endpointUrl: string;
  private signer: any;
  private maxTokenBudget: number;
  private allowanceBudget?: number;
  private activePaymentHeader: string | null = null; // Local cache for active session pass

  constructor(config: ClientConfig) {
    this.endpointUrl = config.endpoint.replace(/\/$/, "");
    this.signer = config.signer;
    this.maxTokenBudget = config.maxTokenBudget || 1000;
    this.allowanceBudget = config.allowanceBudget;
  }

  /**
   * Generates a secure universal UUID v4
   */
  private generateUUID(): string {
    const g = globalThis as any;
    if (g.crypto && typeof g.crypto.randomUUID === "function") {
      return g.crypto.randomUUID();
    }
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0;
      const v = c === "x" ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  }

  /**
   * Executes an MCP tool via ContextSlim with intelligent x402 payment management.
   */
  async callTool(name: string, args: any): Promise<CallToolResult> {
    const body = {
      jsonrpc: "2.0",
      id: this.generateUUID(),
      method: "tools/call",
      params: { name, arguments: args },
    };

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };

    // Proactively attach session pass if available in memory
    if (this.activePaymentHeader) {
      headers["X-PAYMENT"] = this.activePaymentHeader;
    }

    // 1. INITIAL REQUEST
    let response = await fetch(`${this.endpointUrl}/message`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });

    // 2. x402 PAYMENT REQUIRED CHALLENGE (HTTP 402)
    if (response.status === 402) {
      this.activePaymentHeader = null; // Clear previous allowance header if expired or exhausted

      const paymentData = await response.json().catch(() => ({}));
      const paymentHeaderStr = response.headers.get("PAYMENT-REQUIRED") || "";

      // Sign new challenge
      const signedHeader = await this.signX402Challenge(paymentData, paymentHeaderStr);
      headers["X-PAYMENT"] = signedHeader;

      // If an allowance budget is configured, store the signed pass in local memory
      if (this.allowanceBudget && this.allowanceBudget > 0) {
        this.activePaymentHeader = signedHeader;
      }

      // Retry request with signed header
      response = await fetch(`${this.endpointUrl}/message`, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
      });
    }

    if (!response.ok) {
      const errorText = await response.text().catch(() => "");
      throw new Error(`ContextSlimSDK: Network error (${response.status}): ${errorText}`);
    }

    // 3. EXTRACT AUDIT METRICS RECEIVED IN HEADERS
    const savedTokens = response.headers.get("X-ContextSlim-Saved-Tokens");
    const compressionRatio = response.headers.get("X-ContextSlim-Compression-Ratio");
    const strategy = response.headers.get("X-ContextSlim-Strategy");

    const json = (await response.json()) as any;

    // 4. SMART MCP RESULT UNWRAPPING / PARSING
    let finalResult = json.result;

    if (json.result && Array.isArray(json.result.content) && json.result.content[0]?.text) {
      const rawText = json.result.content[0].text;
      try {
        finalResult = JSON.parse(rawText);
      } catch {
        finalResult = rawText;
      }
    }

    return {
      result: finalResult,
      metrics: {
        savedTokens,
        compressionRatio,
        strategy,
      },
    };
  }

  /**
   * Signs the EIP-712 authorization (ERC-3009 TransferWithAuthorization) for x402.
   */
  private async signX402Challenge(paymentData: any, paymentHeaderStr: string): Promise<string> {
    const accepts = paymentData.accepts || paymentData.error?.data?.accepts || {};
    const network = accepts.network || "base-sepolia";
    const asset = accepts.asset || "USDC";

    // Priority: 1. Client allowanceBudget | 2. Base amount required by server
    const amount = (this.allowanceBudget && this.allowanceBudget > 0)
      ? this.allowanceBudget.toString()
      : (accepts.amount || "0.001");

    const payTo = accepts.payTo || "0x0000000000000000000000000000000000000000";

    const isSepolia = network.toLowerCase().includes("sepolia");
    const chainId = isSepolia ? 84532 : 8453;
    const usdcContract = isSepolia ? USDC_ADDRESSES.sepolia : USDC_ADDRESSES.mainnet;

    // 🎯 FIX: Base Sepolia requiere "USDC", Base Mainnet requiere "USD Coin"
    const tokenName = isSepolia ? "USDC" : "USD Coin";

    const domain = {
      name: tokenName,
      version: "2",
      chainId,
      verifyingContract: usdcContract,
    };

    const types = {
      TransferWithAuthorization: [
        { name: "from", type: "address" },
        { name: "to", type: "address" },
        { name: "value", type: "uint256" },
        { name: "validAfter", type: "uint256" },
        { name: "validBefore", type: "uint256" },
        { name: "nonce", type: "bytes32" },
      ],
    };

    const validAfter = 0;
    const validBefore = Math.floor(Date.now() / 1000) + 3600; // 1-hour validity window

    // Universal random byte generation
    const randomBytes = new Uint8Array(32);
    const g = globalThis as any;
    const cryptoObj = g.crypto || (typeof crypto !== "undefined" ? crypto : null);

    if (cryptoObj && typeof cryptoObj.getRandomValues === "function") {
      cryptoObj.getRandomValues(randomBytes);
    } else {
      for (let i = 0; i < 32; i++) {
        randomBytes[i] = Math.floor(Math.random() * 256);
      }
    }

    const nonce = "0x" + Array.from(randomBytes)
      .map(b => b.toString(16).padStart(2, "0"))
      .join("");

    const valueInAtomicUnits = BigInt(Math.round(parseFloat(amount) * 1_000_000));
    
    // Obtener la dirección de la wallet soportando async (Ethers) o sync (Viem)
    const signerAddress = await (typeof this.signer.getAddress === "function"
      ? this.signer.getAddress()
      : this.signer.address);

    const value = {
      from: signerAddress,
      to: payTo,
      value: valueInAtomicUnits.toString(),
      validAfter,
      validBefore,
      nonce,
    };

    // Invocar firma compatible con Ethers v5, v6 y Viem
    const signFn = (this.signer.signTypedData || this.signer._signTypedData).bind(this.signer);
    let signature = await signFn(domain, types, value);

    if (typeof signature !== "string") {
      signature = String(signature);
    }
    if (!signature.startsWith("0x")) {
      signature = "0x" + signature;
    }

    const x402Payload = {
      version: "1.0",
      from: signerAddress,
      payTo,
      amount,
      asset,
      network,
      nonce,
      validUntil: validBefore,
      signature,
    };

    const jsonStr = JSON.stringify(x402Payload);

    // Universal Base64 encoding (Browser + Node.js)
    if (typeof btoa !== "undefined") {
      return btoa(jsonStr);
    }
    return (globalThis as any).Buffer.from(jsonStr).toString("base64");
  }
}