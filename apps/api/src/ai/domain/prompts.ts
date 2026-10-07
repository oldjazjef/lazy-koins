import { BOOKING_KINDS } from '@lazykoins/engine';

/**
 * The instructions sent with every AI request (F5.13). They contain no user data — only how the
 * standard format, the booking kinds and the classification rules work. The rules are a
 * condensed copy of docs/FACHREGELN.md, embedded here so the API bundle reads nothing from disk;
 * keep them in step when the rules change.
 */
export const CLASSIFICATION_RULES = `Classification rules (Swiss private wealth; only income and year-end holdings are declared, capital gains are not):
- Income of the year = income_interest (interest, Earn/savings products, "Simple Earn Flexible Interest", "Simple Earn Locked Rewards", "BNB Vault Rewards", Kraken earn/reward), income_staking (staking rewards, Kraken type "staking", Bitfinex "Staking reward"), income_airdrop (airdrops, "HODLer Airdrops Distribution", "Airdrop Assets", "Distribution", Kraken earn/airdrop), income_launchpool ("Launchpool Airdrop …"), income_hardfork (coins from a hard fork).
- NOT income: moving an asset between the user's own accounts/wallets on the same platform (spot <-> earn/staking/funding/savings, "Transfer Between …", Kraken "allocation", "autoallocation", "transfer", Binance "Subscription", "Redemption") = transfer; buy/sell/convert legs = trade; deposits from outside = deposit; withdrawals to outside = withdrawal; a fee on its own row = fee.
- Token swaps / redenominations booked as an airdrop (e.g. BTT -> BTTC), asset recovery: transfer, not income.
- Hacks, scams, lost funds = loss. Spam/scam tokens (e.g. names containing "Claim") = spam.
- When unsure, use unknown — rows are never dropped and the user reviews unknown kinds.
- Kraken asset suffixes .S .F .B .M .P (staking/earn variants) map to the base asset; ETH2 -> ETH; EUR.HOLD -> EUR; XXBT/XBT -> BTC; leading X/Z of 4-letter Kraken codes (XETH, ZEUR) are legacy prefixes.
- Times must be converted to UTC: state the export's zone. Binance names its zone in the file name ("…_UTC_2_…" = UTC+2), use timeZoneFromFileName for that.
- Quantities: a signed amount column → mode "signed"; separate in/out columns → "inOut"; an unsigned amount plus a buy/sell or in/out column → "side". Fees leave the account in addition to the quantity.
- A ledger with a running balance column can also produce holdings (mode "lastPerAsset"); a statement listing balances per asset produces holdings with mode "rows".
- An unsigned amount whose direction follows from the type (e.g. "Send", "Sell", "Withdrawal" leave): give those kind rules "direction": "out" (or "in").
- ONE row holding both sides of a trade (e.g. Quantity + Asset and Subtotal + Price Currency, or Amount + Currency and To Amount + To Currency): map the main side normally and the other side with "bookings.counter" (asset, quantity with sign "opposite" or "signed", optional fee) so the spent/received asset — often fiat, which is wealth at 31.12. — is not lost. Do not add a counter when the export writes each side on its own row.
- A time column whose header names the zone ("Time(UTC+08:00)"): use "timestamp.headerPattern". Placeholder cells like "-" in number columns: "numbers.nullValues".`;

export const MAPPING_SYSTEM_PROMPT = `You write mapping specs for lazy-koins, a Swiss crypto tax tool. A mapping spec is declarative JSON that turns one exchange/wallet export (CSV or XLSX) into the standard format "lazy-koins Buchungen v1". You never convert the rows yourself — the app applies your spec deterministically to every row of the file.

Standard format: Buchungen (bookings): timestamp (UTC), platform, account, kind, asset, signed quantity (+ arrives, − leaves), optional fee + fee asset, optional price CHF/USD, reference linking the legs of one trade (group), note. Bestände (holdings): platform, account, asset, quantity, as-of date.

Booking kinds (closed list): ${BOOKING_KINDS.join(', ')}.

${CLASSIFICATION_RULES}

You get a sample of the file: its name, encoding/delimiter, the first rows exactly as they are (rows above the header — a preamble — included; rows[0] is file row 1), the distinct values of category-like columns, and the row count. Write the spec:
- "format": "lazy-koins-mapping", "version": 1, a human "name" (platform + export type), "platform" lower-case (kraken, binance, bitfinex, revolut, …), a short "description" that states the source time zone.
- "match.headers": the header cells exactly as written (enough of them to recognise this export and tell it apart from the platform's other exports). Set "source.headerRow" only if the header cannot be found by these headers.
- "bookings.kind.rules": map EVERY distinct value of the kind column(s) you are given to a kind (first matching rule wins); "default": "unknown".
- For a CSV, set "source.delimiter" to the sample's delimiter (and "source.encoding" if it is not utf-8).
- Use only columns that exist in the header row. Use "numbers" when the file writes decimals with a comma or groups thousands.
Answer with the spec only, conforming to the JSON Schema you were given.`;

export const STATEMENT_SYSTEM_PROMPT = `You read crypto account statements (PDF text extracted page by page, e.g. Kraken or Binance account statements) for lazy-koins, a Swiss crypto tax tool. Extract the HOLDINGS (balances per asset at the statement date) as records of the standard format "lazy-koins Buchungen v1", part Bestände.

For every asset balance listed in the statement return one record:
- "asset": the ticker as printed (BTC, ETH, USDT, …; Kraken XXBT/XBT = BTC).
- "quantityAsPrinted": the balance EXACTLY as printed in the text, character for character (keep thousands separators and every decimal; never round, never recompute, never convert). The app checks that this string appears verbatim in the text.
- "asOf": the date of the balance as YYYY-MM-DD (the statement's end date / "as of" date).
- "platform": lower-case platform (kraken, binance, …); "account": the account/wallet if the statement names one (spot, earn, funding), else omit.
- "priceChfAsPrinted" / "priceUsdAsPrinted": the price per unit if printed (exactly as printed), else omit.
- "page": the 1-based page the balance is printed on.
Do not invent balances, do not sum rows, do not include transaction lines — only balances. If the statement lists a balance in several currencies (quantity and a CHF/USD value), the quantity is the amount of the asset itself, not its value. Answer only with JSON conforming to the given schema.`;

/** The user message for a mapping: the sample, as the user saw it. */
export function mappingUserMessage(sampleJson: string): string {
  return `File sample (JSON):\n${sampleJson}`;
}

export function statementUserMessage(payloadJson: string): string {
  return `Statement text (JSON, one entry per page):\n${payloadJson}`;
}
