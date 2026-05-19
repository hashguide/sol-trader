import { Connection, Keypair, PublicKey, Transaction, VersionedTransaction } from '@solana/web3.js'
import bs58 from 'bs58'

const JUP_API = 'https://quote-api.jup.ag/v6'
const JUP_PERPS_API = 'https://perps-api.jup.ag/v1'
const PRICE_API = 'https://api.jup.ag/price/v2'

let connection = null
let keypair = null

export function initSolana(rpcUrl, privateKeyB58) {
  connection = new Connection(rpcUrl || 'https://api.mainnet-beta.solana.com', 'confirmed')
  if (privateKeyB58) {
    try {
      const secret = bs58.decode(privateKeyB58)
      keypair = Keypair.fromSecretKey(secret)
      return keypair.publicKey.toString()
    } catch (e) {
      console.error('Invalid private key:', e.message)
      return null
    }
  }
  return null
}

export function getWalletAddress() {
  return keypair?.publicKey?.toString() || null
}

export async function getTokenPrice(mintAddress) {
  try {
    const res = await fetch(`${PRICE_API}?ids=${mintAddress}`)
    const data = await res.json()
    return data?.data?.[mintAddress]?.price || null
  } catch (e) {
    return null
  }
}

export async function getMultipleTokenPrices(mints) {
  try {
    const ids = mints.join(',')
    const res = await fetch(`${PRICE_API}?ids=${ids}`)
    const data = await res.json()
    return data?.data || {}
  } catch (e) {
    return {}
  }
}

export async function getQuote(inputMint, outputMint, amountLamports, slippageBps = 50) {
  try {
    const params = new URLSearchParams({
      inputMint,
      outputMint,
      amount: amountLamports.toString(),
      slippageBps: slippageBps.toString(),
      onlyDirectRoutes: 'false',
    })
    const res = await fetch(`${JUP_API}/quote?${params}`)
    const data = await res.json()
    if (data.error) throw new Error(data.error)
    return data
  } catch (e) {
    throw new Error(`Quote failed: ${e.message}`)
  }
}

export async function executeSwap(quote, walletPublicKey) {
  try {
    const res = await fetch(`${JUP_API}/swap`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        quoteResponse: quote,
        userPublicKey: walletPublicKey || keypair?.publicKey?.toString(),
        wrapAndUnwrapSol: true,
        dynamicComputeUnitLimit: true,
        prioritizationFeeLamports: 'auto',
      }),
    })
    const { swapTransaction, error } = await res.json()
    if (error) throw new Error(error)

    if (!keypair) throw new Error('No keypair configured for live trading')

    const txBuffer = Buffer.from(swapTransaction, 'base64')
    const tx = VersionedTransaction.deserialize(txBuffer)
    tx.sign([keypair])

    const txid = await connection.sendTransaction(tx, { maxRetries: 3 })
    await connection.confirmTransaction(txid, 'confirmed')
    return txid
  } catch (e) {
    throw new Error(`Swap failed: ${e.message}`)
  }
}

export async function getPerpsMarkets() {
  try {
    const res = await fetch(`${JUP_PERPS_API}/markets`)
    return await res.json()
  } catch {
    return []
  }
}

export async function getWalletBalance(publicKey) {
  if (!connection) return null
  try {
    const pk = new PublicKey(publicKey || keypair?.publicKey)
    const balance = await connection.getBalance(pk)
    return balance / 1e9
  } catch {
    return null
  }
}

export async function scanTopTokens(limit = 20) {
  try {
    // Jupiter token list + price data for market scanning
    const res = await fetch('https://token.jup.ag/strict')
    const tokens = await res.json()
    const sample = tokens.slice(0, 100)
    const mints = sample.map(t => t.address).slice(0, 30)
    const prices = await getMultipleTokenPrices(mints)

    return sample
      .filter(t => prices[t.address])
      .map(t => ({
        mint: t.address,
        symbol: t.symbol,
        name: t.name,
        logoURI: t.logoURI,
        price: prices[t.address]?.price,
      }))
      .slice(0, limit)
  } catch {
    return []
  }
}

export { connection, keypair }
