# Standard mappings

Ready-to-import mapping specs (`lazy-koins-mapping` v1) for the exports of the ten best-known
crypto platforms. Each one turns a platform export into standard bookings ("lazy-koins Buchungen
v1"), classified under the Swiss rules in [`docs/FACHREGELN.md`](../../docs/FACHREGELN.md).

- `*.mapping.json`: the specs. Each `description` says which export the spec is for and lists its
  known limits.
- `samples/*.csv`: one **synthetic** sample per spec. The values are invented. The layout follows
  the published format, and every type value the spec classifies appears at least once.
- `libs/engine/src/mapping/standard-mappings.spec.ts` checks each spec. A spec must validate and
  read its sample without row errors or `unknown` kinds. Kind counts and trade pairing must match,
  and the privacy scan must find nothing. No spec may recognise another spec's sample, and none may
  recognise the standard-format templates. The suite runs in `pnpm test`.

## How to import

- **Mappings page** (`/app/mappings`): click "Upload .json" and pick the file. From then on, uploads
  of that export are recognised automatically by their column headers.
- **Mapping library** (web only): open a mapping on the Mappings page and click "Publish to
  library". Other users can then take a copy.
- **Check against a real export first.** Platforms change their exports without notice. Open the
  mapping, load one of your real files as the sample file in the editor, and look at the preview.
  It shows row errors, kind counts, the fingerprint verdict and every value that falls to
  `unknown`. Add a rule for each unknown value and save. If one of your exports has a column set
  that differs from the one documented here, the fingerprint (`match.headers`) does not match.
  Adjust it in that case.

## Overview

| Platform   | Export                                          | Where (platform UI)                                                                                  | Spec                                        | Confidence |
| ---------- | ----------------------------------------------- | ---------------------------------------------------------------------------------------------------- | ------------------------------------------- | ---------- |
| Binance    | Transaction History (CSV)                       | Orders › Transaction History › Export (or Wallet › Transaction History › Export Transaction Records) | `binance-transaction-history.mapping.json`  | medium     |
| Coinbase   | Transaction history report (CSV)                | Profile › Statements / Reports › Generate report › Transaction history, CSV                          | `coinbase-transaction-history.mapping.json` | medium     |
| Kraken     | Ledgers (CSV)                                   | History › Export › Ledgers (all fields)                                                              | `kraken-ledger.mapping.json`                | high       |
| Bitfinex   | Ledgers report (CSV)                            | Reports › Ledgers › Export                                                                           | `bitfinex-ledger.mapping.json`              | medium–low |
| Bybit      | Unified Trading Account – Transaction Log (CSV) | Assets › Unified Trading Account › History › Transaction Log › Export                                | `bybit-transaction-log.mapping.json`        | low–medium |
| OKX        | Trading account bills (CSV)                     | Assets › Order center / Bills › Trading account › Download                                           | `okx-trading-account-history.mapping.json`  | low–medium |
| OKX        | Funding account bills (CSV)                     | Assets › Order center / Bills › Funding account › Download                                           | `okx-funding-account-history.mapping.json`  | low–medium |
| KuCoin     | Spot Orders – Filled Orders (CSV)               | Orders › Spot Orders › Export, or Account › Export History › Spot Orders (Filled)                    | `kucoin-spot-orders.mapping.json`           | medium     |
| KuCoin     | Account History – Funding Account (CSV)         | Account › Export History › Account History (Funding Account)                                         | `kucoin-account-history.mapping.json`       | low        |
| Crypto.com | App – Crypto Wallet transaction history (CSV)   | App: Accounts › Crypto Wallet › Transaction History › Export (sent by e-mail)                        | `cryptocom-app-crypto-wallet.mapping.json`  | medium     |
| Bitstamp   | Transaction history, CSV "RFC 4180 (new)"       | Profile › History › Transaction history › Open export options › RFC 4180                             | `bitstamp-transactions.mapping.json`        | medium–low |
| Bitpanda   | Transaction history (CSV)                       | Profile › History › Transaction history › Export CSV                                                 | `bitpanda-transactions.mapping.json`        | medium     |

The confidence levels mean:

- **high**: the format was confirmed against official documentation and at least one maintained
  importer.
- **medium**: the headers and types were confirmed by a maintained importer (BittyTax). Some
  details (sign, date format, rare types) come from secondary sources.
- **low**: the layout or the type wording could not be confirmed. Check the preview with a real
  export.

Only the Kraken ledger has been compared against a real export, and only its header row
(`pnpm private:inspect`, structure only). No real Binance or Bitfinex export was available for
comparison.

### Format features the specs use

Some exports write both sides of a trade in **one** row, for example Coinbase, Crypto.com,
Bitstamp, Bitpanda and KuCoin spot orders. For these, the spec uses `bookings.counter`, which books
the other side as a second leg with the same row, kind and group. Its record id is
`<file>:<row>:counter`. This keeps the fiat or quote currency that is spent or received, which is
wealth at 31.12.

The same mechanism books moves into Earn, staking or lockups as two transfers between accounts
(`earn`, `staking`, `savings`, `supercharger`). The asset stays owned and the total does not
change.

Other options used here:

- `direction` on a kind rule: for unsigned amounts.
- `asset.pattern`: for pairs such as `BTC-USDT`.
- `numbers.nullValues`: for placeholder cells such as `-`.
- `quantity.fallbackColumn`: used when the primary amount column is empty.
- `timestamp.headerPattern`: for KuCoin's `Time(UTC+08:00)` header.

## The formats, platform by platform

The sections below describe what the export looks like and how each value is classified. Items
marked **(unconfirmed)** could not be confirmed from a source. Check them against a real export.

### Binance – Transaction History

- **File**: CSV, `,`, UTF-8, no preamble. An XLSX variant with a preamble exists but is not
  covered here.
- **Header**: `User_ID, UTC_Time, Account, Operation, Coin, Change, Remark`. Older files lack
  `User_ID`.
- **Date**: `2025-01-31 12:00:00`, in the time zone chosen in the export dialog. Binance writes the
  zone into the file name (`…_UTC_2_…` = UTC+2, `timeZoneFromFileName`). Without it, UTC is assumed
  and a note is recorded.
- **Numbers**: `Change` is signed, with `.` as the decimal separator and no thousands separator.
  Fees are rows of their own.
- **Account**: `Account` (Spot, Funding, Earn, USDT-Futures, Cross Margin, Pool, Card, …).
- **Grouping**: trade legs have no common id. Rows of the same second share a group
  (`group = UTC_Time`).
- **Kinds**:
  - trade: Buy, Sell, Transaction Related / Buy / Spend / Sold / Revenue, Binance Convert, Large
    OTC trading, Small Assets Exchange BNB, Auto-Invest Transaction, Buy Crypto With Card, P2P
    Trading, Stablecoins Auto-Conversion, ETH 2.0 Staking, Leverage Token Redemption, Leveraged
    Coin Consolidation, Swap Farming Transaction, Liquid Swap Sell, Asset Conversion Transfer,
    Futures Convert, Realized Profit and Loss / Realize profit and loss.
  - fee: Fee, Transaction Fee, BNB Fee Deduction, Funding Fee, Insurance Fund Compensation.
  - deposit: Deposit, Fiat Deposit, Fiat OCBS - Add Fiat and Fees.
  - withdrawal: Withdraw, Fiat Withdraw, Fiat Withdrawal, Send, Binance Card Spending.
  - transfer: transfer_in/out, `Transfer Between …`, Simple Earn Flexible/Locked
    Subscription/Redemption, Savings purchase / Principal redemption, POS savings
    purchase/redemption, Staking Purchase/Redemption, Launchpool Subscription/Redemption, Launchpad
    Subscribe, Liquid Swap Add, Add/Sell, Liquidity Farming Remove, Token Swap -
    Redenomination/Rebranding, Asset Recovery, (Isolated) Margin Loan/Repayment, Cross Margin
    Liquidation - Repayment.
  - income_interest: Simple Earn Flexible Interest, Simple Earn Locked Rewards, BNB Vault Rewards,
    Savings Interest/Distribution, Pool Distribution, Super BNB Mining, Liquid Swap Rewards, Swap
    Farming Rewards.
  - income_staking: Staking Rewards, ETH 2.0 Staking Rewards, POS savings interest, DOT Slot
    Auction Rewards.
  - income_launchpool: every `Launchpool …` (Airdrop, System/User Claim Distribution, Interest,
    Earnings Withdrawal).
  - income_airdrop: Airdrop Assets, Distribution, HODLer Airdrops Distribution, Simple Earn
    Flexible Airdrop, Megadrop Rewards, Campaign Related Reward, Mission Reward Distribution, Token
    Swap - Distribution, Cash Voucher Distribution, Binance Card Cashback, and referral/commission
    rewards (Referral Kickback, Referral Commission, Commission History, Commission Rebate,
    Commission Fee Shared With You, Referrer rebates).
  - Left `unknown`: Crypto Box (a gift sent or received).
- **Gaps**:
  - Earn income booked inside Earn without a ledger row is missing. The Account Statement and the
    Earn gap cover it.
  - Margin debt is not tracked.
  - Futures PnL is booked as trade (capital gain or loss).
  - Rows of the same second from different trades share one group.
- **Sources**:
  [BittyTax binance.py](https://github.com/BittyTax/BittyTax/blob/master/src/bittytax/conv/parsers/binance.py)
  (headers and operations); `docs/FACHREGELN.md` (file-name zone, income classes).

### Coinbase – Transaction history

- **File**: CSV, `,`. The preamble is a blank line, `Transactions`, then `User,<name>,<id>`
  **(unconfirmed: line count)**. The header is found automatically.
- **Header**: `ID, Timestamp, Transaction Type, Asset, Quantity Transacted, Price Currency, Price at
Transaction, Subtotal, Total (inclusive of fees and/or spread), Fees and/or Spread, Notes`.
  Files without `ID` also work.
- **Date**: `2025-01-15 10:00:00 UTC` (the zone is in the cell).
- **Numbers**: money columns carry symbols and thousands separators (`CHF4,313.75`, `$5.00`); they
  are stripped. The direction comes from the type, so a negative or unsigned `Quantity Transacted`
  makes no difference.
- **Two legs**:
  - Buy and Sell rows book the asset leg plus the money leg (`Subtotal` in `Price Currency`, with
    `Fees and/or Spread` as its fee).
  - Convert takes the received asset from `Notes` (`Converted 0.5 ETH to 1,612.9 USDC`).
- **Kinds**:
  - trade: Buy, Sell, Advanced Trade Buy/Sell (also "Advance Trade …"), Retail MGX DEX Buy, Retail
    Simple Dust, Convert.
  - deposit: Deposit, Receive, Exchange Withdrawal, Pro Withdrawal.
  - withdrawal: Withdrawal, Send, Retail MGX DEX Send, Exchange/Pro/Prime Deposit, Card Spend,
    Donation, Admin Debit.
  - fee: Subscription.
  - income_staking: Staking Income, Rewards Income, Reward Income, Inflation Reward.
  - income_interest: Interest payout.
  - income_airdrop: Coinbase Earn, Learning Reward, Incentives Rewards Payout, Subscription Rebate(s
    (24 Hours)), and Receive with Notes mentioning "Coinbase Referral/Earn/Rewards".
  - transfer: Retail (Un)Staking Transfer and Cash to Savings / Savings to Cash / Vault Withdrawal
    (each paired with the account `staking` / `savings`), Transfer, Asset Migration, Retail Eth2
    Deprecation.
  - Unknown: anything else (e.g. "Credit").
- **Gaps**:
  - A card-funded Buy also books the money leg on the Coinbase cash balance, which can then go
    negative.
  - Advanced Trade rows priced in a stablecoin still give `Subtotal` in the native currency.
  - The older layout (`Spot Price Currency`, 2021–2023) is not covered.
- **Sources**:
  [BittyTax coinbase.py](https://github.com/BittyTax/BittyTax/blob/master/src/bittytax/conv/parsers/coinbase.py)
  (headers v2–v4, types, Convert note).

### Kraken – Ledgers

- **File**: CSV, `,`, no preamble.
- **Header**: `txid, refid, time, type, subtype, aclass, subclass, asset, wallet, amount, fee,
balance, amountusd, feeusd, balanceusd, feecurrency`. Older exports lack `subclass`, `wallet`,
  `amountusd` and `fee…`. The fingerprint needs only the stable ten.
- **Date**: `2025-01-15 10:00:00.1234`, UTC.
- **Numbers**: `amount` is signed. `fee` is charged on top, in `feecurrency` when it differs.
  `amountusd` / `feeusd` value the income.
- **Rows and grouping**: rows with an empty `txid` (pending duplicates) are excluded. `refid` links
  the legs. `wallet` becomes the account. The running `balance` per account and raw asset is read
  as `lastPerAsset`.
- **Assets**:
  - X/Z prefixes and XBT become BTC.
  - The suffixes `.S .M .F .B .P .HOLD .CORE .INK` and numbered bonding (`DOT28.S`) are dropped.
  - `ETH2` becomes `ETH`.
- **Kinds**:
  - trade: trade, spend, receive, sale, settled, adjustment, earn/delistingconversion,
    transfer/delistingconversion.
  - deposit: deposit. withdrawal: withdrawal.
  - income_staking: staking.
  - income_interest: earn/reward, dividend.
  - income_airdrop: earn/airdrop, transfer/airdrop, invite bonus, credit.
  - transfer: earn/allocation, deallocation, autoallocate, autoallocation, migration;
    transfer/spottostaking, stakingfromspot, stakingtospot, spotfromstaking, spottofutures,
    spotfromfutures; custodytransfer.
  - fee: rollover.
  - Left `unknown` on purpose: transfer without subtype (a fork or airdrop credit, or an OTC or
    futures move), earn without subtype, margin trade, NFT types.
- **Sources**:
  - [Kraken: How to interpret Ledger history fields](https://support.kraken.com/articles/360001169383-how-to-interpret-ledger-history-fields)
  - [BittyTax kraken.py](https://github.com/BittyTax/BittyTax/blob/master/src/bittytax/conv/parsers/kraken.py)
    (7 header variants, types/subtypes, asset codes)
  - [Kraken API Get Ledgers](https://docs.kraken.com/api-reference/account-data/get-ledgers-info)
    (type list)

### Bitfinex – Ledgers

- **File**: CSV, `,`, no preamble.
- **Header**: `#, DESCRIPTION, CURRENCY, AMOUNT, BALANCE, DATE, WALLET`.
- **Date**: day first, `15-01-2025 10:00:00` (also `15-01-25`), in the zone of the report settings.
  UTC is assumed **(unconfirmed: depends on the user's report preferences)**.
- **Numbers**: `AMOUNT` is signed. Fees are rows of their own.
- **Accounts and grouping**: `WALLET` (exchange, margin, funding) becomes the account. The running
  `BALANCE` per wallet and currency is read. The legs of a trade share their `DATE` (the group).
- **Kinds** (regexes on `DESCRIPTION`) **(wording partly unconfirmed)**:
  - fee: `Trading fee(s) for …`, `… Withdrawal fee`, `Deposit Fee …`, `… Margin Funding Charge`.
  - trade: `Exchange X for Y @ …`, `Settlement …`, `Position closed/claimed …`.
  - deposit: `Deposit (…) #…`.
  - withdrawal: `… Withdrawal #…`, `Canceled withdrawal …`.
  - transfer: `Transfer of … from wallet … to …`.
  - income_staking: `Staking Reward …`.
  - income_interest: `Margin Funding Payment`, `Interest Payment`.
  - income_airdrop: `Earned fees from user …`, `Affiliate Rebate …`, `Airdrop …`, `Distribution …`.
  - income_hardfork: `… fork …`.
- **Aliases**: UST becomes USDT, IOT becomes IOTA.
- **Gaps**:
  - Margin positions are booked as trade.
  - Description texts Bitfinex adds later fall to unknown.
- **Sources**:
  [BittyTax bitfinex.py](https://github.com/BittyTax/BittyTax/blob/master/src/bittytax/conv/parsers/bitfinex.py)
  (headers); `docs/FACHREGELN.md` (date format, "Staking reward");
  [Bitfinex Staking Rewards](https://support.bitfinex.com/hc/en-us/articles/900004459563-Staking-Rewards-on-Bitfinex).

### Bybit – Unified Trading Account Transaction Log

- **File**: CSV, `,`.
- **Header**: `Time, Currency, Contract, Type, Direction, Quantity, Position, Filled Price, Funding,
Fee Paid, Cash Flow, Change, Wallet Balance, Fee Rate, Trade ID, Order ID`. Newer UTA exports may
  add `Uid` / `Action` or name the time column `Time(UTC)` **(unconfirmed)**.
- **Date**: `2025-05-01 08:00:00`, UTC. A zone written in the time header is honoured.
- **Numbers**: `Change` (= cash flow + funding − fee) is the signed balance change, so the fee is
  not booked twice. `Wallet Balance` is read as `lastPerAsset`. `--` counts as empty.
- **Grouping**: a spot trade writes one row per currency, linked by `Order ID`.
- **Kinds** (Bybit's transaction-log enum; older exports use lower case):
  - trade: TRADE, exchangeIn/Out, CURRENCY_BUY/SELL, CONVERT, SPOT_REPAYMENT_BUY/SELL,
    EARNING_REDEMPTION_BUY/SELL, DELIVERY, LIQUIDATION, ADL, FORWARD/REVERSE_SPLIT_SETTLE.
  - fee: SETTLEMENT, funding, FEE_REFUND, INTEREST (interest _paid_ on borrowing),
    CUSTODY_NETWORK_FEE, CUSTODY_SETTLE_FEE.
  - deposit: deposit. withdrawal: withdraw.
  - transfer: TRANSFER_IN/OUT, transferIn/Out, BONUS_/PEF_TRANSFER_IN/OUT, BORROW, REPAY,
    FLOATING_TO_FIXED_BORROW/REPAY, LOANS_*, institution-loan types, CUSTODY_LOCK/UNLOCK(_REFUND),
    every `…_SUBSCRIPTION`, `…_REDEMPTION`, `…_REFUND`, BYUSDT_MINT.
  - income_interest: BYUSDT_INTEREST, DIVIDEND_SETTLEMENT.
  - income_airdrop: AIRDROP, BONUS.
  - Left `unknown`: BONUS_RECOLLECT, PEF_PROFIT_SHARE.
- **Gaps**:
  - The **Funding account** (where deposits, withdrawals, P2P and Earn happen) has its own history.
    It is not covered; its moves into the UTA appear here as transfers.
  - Derivatives PnL and funding are booked as trade and fee.
- **Sources**:
  - [Bybit API: transaction log](https://bybit-exchange.github.io/docs/v5/account/transaction-log)
  - [Bybit API: type enum (UTA translog)](https://bybit-exchange.github.io/docs/v5/enum#typeuta-translog)
  - [BittyTax bybit.py](https://github.com/BittyTax/BittyTax/blob/master/src/bittytax/conv/parsers/bybit.py)
    (CSV headers)
  - [Bybit help: self-export account data](https://www.bybit.com/en/help-center/article/How-to-Self-Export-Account-Data)

### OKX – Trading account bills

- **File**: CSV, `,`. A `UID: …` line may stand above the header **(unconfirmed)**.
- **Header**: `id, Order id, Time, Trade Type, Symbol, Action, Amount, Trading Unit, Filled Price,
PnL, Fee, Fee Unit, Position Change, Position Balance, Balance Change, Balance, Balance Unit`.
- **Date**: `2025-06-01 08:00:00`, in the zone chosen at export. Choose UTC; a zone in the time
  header (`Time(UTC+8)`) is honoured.
- **Numbers**: `Balance Change` in `Balance Unit` is signed and includes the fee **(unconfirmed)**,
  so the fee is not booked again. `Balance` is read as `lastPerAsset`.
- **Grouping**: a spot trade writes one row per currency, linked by `Order id`.
- **Kinds** (`Trade Type` / `Action`):
  - fee: `…|Funding fee`, `…|Interest deduction`.
  - transfer: Transfer, `…|Transfer in/out`.
  - trade: Spot, Margin, Futures, Perpetual, Swap, Options, Convert.
- **Sources**:
  [BittyTax okx.py](https://github.com/BittyTax/BittyTax/blob/master/src/bittytax/conv/parsers/okx.py)
  (trades v2 header); [Coinpanda: OKX](https://coinpanda.io/integrations/okx/) and
  [Pocket Portfolio OKX import](https://www.pocketportfolio.app/import/okx) (current header names);
  [OKX help: download statements](https://www.okx.com/en-us/help/how-do-i-download-my-statements).

### OKX – Funding account bills

- **File**: CSV, `,`, optional `UID` line.
- **Header**: `id, Time, Type, Amount, Before Balance, After Balance, Fee, Symbol`.
- **Date and zone**: as for the trading account.
- **Numbers**: `Amount` is signed (deposits and withdrawals are forced in/out). `Fee` is charged on
  top. `After Balance` is read as `lastPerAsset`.
- **Kinds**:
  - deposit: Deposit.
  - withdrawal: Withdrawal, Cancel withdrawal (in).
  - transfer: From/To (unified) trading account, From/To funding account, Transfer in/out, Stake,
    Redeem staking, Savings subscription/redemption, Simple Earn subscription/redemption.
  - income_staking: Staking Yield, ETH staking yield.
  - income_interest: Savings yield, Simple Earn yield/interest.
  - income_airdrop: Airdrop, Fee rebate.
  - trade: Convert, Buy, Sell (no paired leg).
  - Several of these texts are **unconfirmed**.
- **Sources**: [BittyTax okx.py](https://github.com/BittyTax/BittyTax/blob/master/src/bittytax/conv/parsers/okx.py)
  (funding v2 header, types).

### KuCoin – Spot Orders (Filled Orders)

- **File**: CSV from the history ZIP, `,`.
- **Header**: `UID, Account Type, Order ID, Symbol, Side, Order Type, Avg. Filled Price, Filled
Amount, Filled Volume, Filled Volume (USDT), Filled Time(UTC+08:00), Fee, Maker/Taker, Fee
Currency`. A `Tax` column may appear.
- **Date**: `2025-06-03 18:15:00`. The zone is the one named in the time header (chosen at export).
- **Two legs**:
  - The base asset of `Symbol` moves by `Filled Amount` (out on SELL).
  - The quote asset moves by `Filled Volume` the other way.
  - The fee is booked in `Fee Currency`.
  - Both legs are linked by `Order ID`.
- **Kinds**: BUY and SELL are trade.
- **Sources**:
  [BittyTax kucoin.py](https://github.com/BittyTax/BittyTax/blob/master/src/bittytax/conv/parsers/kucoin.py)
  (trades v5 header, UTC-offset time headers);
  [KuCoin: export deposit & withdrawal history](https://www.kucoin.com/support/900007152823).

### KuCoin – Account History (Funding Account)

- **File**: CSV from the history ZIP, `,`.
- **Header**: `UID, Account Type, Currency, Side, Amount, Fee, Time(UTC+08:00), Remark, Type`.
- **Date**: as above (zone from the header).
- **Numbers**: `Amount` is unsigned. `Side` gives the direction (`Deposit` in, `Withdrawal` out).
  `Fee` is in the same currency.
- **Kinds** (regexes on `Type|Remark`) **(wording unconfirmed)**:
  - deposit: `Deposit…`. withdrawal: `Withdraw…`. transfer: `Transfer…`.
  - trade: Spot/Trade/Exchange/Convert/Margin/Futures.
  - income_staking: Staking.
  - income_interest: Lending/Earn/Interest/Savings/Profit.
  - income_airdrop: Airdrop/Distribution/Bonus/Reward/Gift/Rebate/Cashback.
  - fee: Fee/Deduction.
- **Gaps**: the Trading Account file repeats the spot trades of the Filled Orders file, so do not
  import both. Convert rows have no order id to pair them.
- **Sources**: [BittyTax kucoin.py](https://github.com/BittyTax/BittyTax/blob/master/src/bittytax/conv/parsers/kucoin.py)
  (header).

### Crypto.com App – Crypto Wallet

- **File**: CSV, `,`, no preamble.
- **Header**: `Timestamp (UTC), Transaction Description, Currency, Amount, To Currency, To Amount,
Native Currency, Native Amount, Native Amount (in USD), Transaction Kind, Transaction Hash`.
  Older files lack `Transaction Hash`.
- **Date**: `2025-07-01 06:00:00`, UTC.
- **Numbers**: `Amount` is signed. An exchange row holds the spent side (`Currency`/`Amount` < 0)
  and the received side (`To Currency`/`To Amount`). Both are booked.
- **Kinds**:
  - trade: viban_purchase, van_purchase, crypto_viban_exchange, crypto_exchange,
    crypto_to_van_sell_order, crypto_purchase (card, no money leg), recurring_buy_order,
    dust_conversion_debited/credited, trading.crypto_purchase.google_pay/apple_pay,
    trading.limit_order.(fiat_wallet|cash_account).(sell|purchase)_commit,
    trading.limit_order.crypto_wallet.exchange.
  - deposit: crypto_deposit, exchange_to_crypto_transfer, crypto_payment_refund, viban_deposit, and
    an empty kind with "Deposit" in the description.
  - withdrawal: crypto_withdrawal, crypto_to_exchange_transfer, crypto_payment, card_top_up,
    viban_card_top_up, viban_withdrawal, and an empty kind with "Withdraw…".
  - transfer, paired with a second account (`earn`, `staking`, `supercharger`):
    crypto_earn_program_created/withdrawn, lockup_lock/unlock/upgrade,
    finance.lockup.dpos_lock.crypto_wallet, finance.dpos.(un)staking.crypto_wallet,
    supercharger_deposit/withdrawal, council_node_deposit_created.
  - transfer, unpaired: the `…_swap_debited/credited` rows, dynamic_coin_swap_bonus_exchange_deposit,
    viban_deposit_precredit(_repayment).
  - income_interest: crypto_earn_interest_paid, crypto_earn_extra_interest_paid,
    finance.crypto_earn.loyalty_program_extra_interest_paid.crypto_wallet, mco_stake_reward.
  - income_staking: staking_reward, finance.dpos.(non_)compound_interest.crypto_wallet,
    finance.lockup.dpos_compound_interest.crypto_wallet.
  - income_launchpool: supercharger_reward_to_app_credited.
  - income_airdrop: referral_bonus, referral_gift, referral_card_cashback, card_cashback_reverted,
    transfer_cashback, reimbursement(_reverted), gift_card_reward, admin_wallet_credited,
    campaign_reward, rewards_platform_deposit_credited.
  - Excluded (they only reserve funds): trading.limit_order.*.(fund|purchase|sell)_(lock|unlock).
  - Left `unknown`: crypto_transfer (to or from another app user: a gift or your own account).
- **Gaps**:
  - Do not also import the Fiat Wallet export for the same period, because the fiat leg of viban
    exchanges is booked here.
  - Whether lock and Earn rows carry a negative amount is **unconfirmed**.
  - Crypto.com Exchange has its own exports.
- **Sources**:
  [BittyTax cryptocom.py](https://github.com/BittyTax/BittyTax/blob/master/src/bittytax/conv/parsers/cryptocom.py)
  (headers, every kind incl. the skipped ones).

### Bitstamp – Transaction history (RFC 4180)

- **File**: CSV, `,`.
- **Header**: `ID, Account, Type, Subtype, Datetime, Amount, Amount currency, Value, Value currency,
Rate, Rate currency, Fee, Fee currency, Order ID`.
- **Date**: ISO, `2025-08-01T09:00:00Z` **(unconfirmed)**.
- **Numbers**: amounts are unsigned **(unconfirmed)**. The direction comes from Type/Subtype.
- **Two legs**: a Market row books `Amount` in `Amount currency` plus `Value` in `Value currency`
  the other way. The fee is in `Fee currency`. Both are linked by `Order ID`.
- **Kinds**:
  - trade: Market/Buy (in), Market/Sell (out).
  - deposit: Deposit, Ripple deposit.
  - withdrawal: Withdrawal, Ripple payment.
  - income_staking: Staking reward.
  - transfer: Staked assets (out) / Unstaked assets (in), paired with the account `staking`; Sub
    Account Transfer keeps its own sign.
- **Gaps**: the old export (`Type, Datetime, Account, Amount, Value, Rate, Fee, Sub Type` with
  amounts like `0.5 BTC` and dates like `Jan. 01, 2021, 10:00 AM`) is not covered.
- **Sources**:
  [BittyTax bitstamp.py](https://github.com/BittyTax/BittyTax/blob/master/src/bittytax/conv/parsers/bitstamp.py)
  (headers v1 and v2, types); [CoinLedger: Bitstamp import](https://help.coinledger.io/en/articles/2819071-bitstamp-file-import-guide)
  (export path, old format).

### Bitpanda – Transaction history

- **File**: CSV, `,`. A preamble (disclaimer, `UserId: …`, blank lines) sits above the header, which
  is found automatically.
- **Header**: `Transaction ID, Timestamp, Transaction Type, In/Out, Amount Fiat, Fiat, Amount Asset,
Asset, Asset market price, Asset market price currency, Asset class, Product ID, Fee, Fee asset,
Spread, Spread Currency, Tax Fiat`.
- **Date**: ISO with offset, `2025-09-01T10:00:00+02:00`.
- **Numbers**: unsigned. `In/Out` (`incoming` / `outgoing`) gives the direction. `-` counts as empty.
  Cash deposits and withdrawals without `Amount Asset` use `Amount Fiat`.
- **Two legs**: buy and sell rows book the asset plus the money (`Amount Fiat` in `Fiat`, the other
  way). The fee is in `Fee asset` (often BEST).
- **Kinds**:
  - trade: buy, sell.
  - deposit: deposit, refund.
  - withdrawal: withdrawal (card payments too).
  - income_staking: transfer + incoming (rewards: staking, BEST, cashback).
  - transfer: transfer + outgoing; transfer(stake) and transfer(unstake), paired with the account
    `staking` **(unconfirmed wording)**.
- **Gaps**:
  - Stocks, ETFs and metals (`Asset class`) are booked like crypto.
  - The spread is part of the price, not a separate fee.
  - Swaps from one asset to another are not covered.
  - Whether fiat rows write the currency in `Asset` is **unconfirmed**.
- **Sources**:
  [BittyTax bitpanda.py](https://github.com/BittyTax/BittyTax/blob/master/src/bittytax/conv/parsers/bitpanda.py)
  (headers, `-` placeholder); [bitpanda-csv TransactionType](https://docs.rs/bitpanda-csv/latest/bitpanda_csv/enum.TransactionType.html);
  [Bitpanda: download your history](https://support.bitpanda.com/hc/en-us/articles/360000122759-How-can-I-download-the-history-of-my-Bitpanda-account).

## Changing a mapping

Keep the rule order in mind: the first matching rule decides. Add new type values above any broad
`pattern` rule. After a change, update the sample (invented values only, never a real export) and
the expected counts in `standard-mappings.spec.ts`, then run
`pnpm vitest run --project engine`.
