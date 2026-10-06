# Fachregeln – Schweiz, Privatvermögen

Abgeleitet aus der bisherigen manuellen Auswertung (Steuerjahr 2025). Hier stehen nur **Regeln**;
Werte, Adressen und Mengen gehören nicht ins Repo (siehe CLAUDE.md, Private data). Keine
Steuerberatung – Zweifelsfälle sind als **Annahme** markiert und gehören in die offenen Punkte.

Plattformspezifisches (Spalten, Buchungsarten, Asset-Namen, Zeitzonen) wird **nicht im Code**
umgesetzt, sondern in Mapping-JSONs (ANFORDERUNGEN F5.11); die Abschnitte zu einzelnen
Plattformen beschreiben, was diese Mappings ausdrücken müssen.

## Grundsatz

- Deklariert werden **Vermögen per 31.12.** (Wertschriftenverzeichnis) und **Ertrag** des Jahres
  (Einkommen aus beweglichem Vermögen). Kapitalgewinne im Privatvermögen sind steuerfrei und
  werden nicht ausgewiesen.
- Bewertung in CHF. Ertrag zum Zuflusszeitpunkt (Tageskurs), Vermögen zum Stichtag 31.12.

## Bestand per 31.12.

| Plattform  | Quelle der Menge                                                                                                          |
| ---------- | ------------------------------------------------------------------------------------------------------------------------- |
| Kraken     | Saldo aus dem **Ledger**: Σ `amount` − Σ `fee` je Asset über alle Buchungen mit `time` < 01.01. des Folgejahres           |
| Binance    | **Account Statement** (PDF, Abschnitt „Crypto Holdings“): Menge Ende Jahr; Menge Anfang = Ende − Veränderung              |
| Bitfinex   | Saldo aus dem Ledger                                                                                                      |
| Bittrex    | Saldo aus Transaction History (Plattform im Wind-down; Gutschriften ohne Marktkurs → Annahme Wert 0, offener Punkt)       |
| Revolut    | Krypto-Kontoauszug: **Käufe − Verkäufe** je Asset (der Export enthält nur Handel)                                         |
| EVM-Wallet | On-chain: normale Tx (Eingang +, Ausgang − inkl. Gas `gasUsed × gasPrice`, nur erfolgreiche), interne Tx, Token-Transfers |

- Kraken-Assetnamen: Suffixe `.S`, `.F`, `.B`, `.M`, `.P` (Staking/Earn-Varianten) auf das
  Basis-Asset abbilden; `ETH2` → `ETH`, `EUR.HOLD` → `EUR`. Den Rohnamen behalten.
- Positionen mit |Menge| < 1e-7 entfallen.
- Wallets auf **allen** unterstützten Netzwerken prüfen (gleiche EVM-Adresse auf Ethereum,
  Polygon, Arbitrum, Optimism, Base, BNB Chain); dort nur Spam gefunden → vermerken.
- Netzwerke ohne freie historische Abfrage (z. B. BNB Chain): Saldo manuell mit Beleg, sonst
  offener Punkt.

## Kurse

Rangfolge je Position (erste vorhandene gilt):

1. **ESTV-Kurs** (Kursliste, manuell/Override) – CHF je Einheit
2. **Kurs CHF direkt** – z. B. aus dem Kraken Account Statement (CHF-Bewertung per Stichtag)
3. **Kurs USD × USD/CHF** des Stichtags

- Stablecoins (`USDT`, `USDC`, `BUSD`, `FDUSD`, `USDD`) und `USD` = 1 USD. `CHF` = 1. `EUR` über
  EUR/CHF des Stichtags.
- USD-Kurse: Binance-Tagesschluss (Kline `1d`, Close, UTC) Paar `<SYM>USDT`, sonst `<SYM>BUSD`;
  letzter Kurs ≤ Datum, höchstens **14 Tage** alt, sonst erster Kurs danach (≤ 14 Tage); sonst
  kein Kurs. Weitere Quellen: Börsen-Kerzen (Kraken/Bitfinex), CoinGecko.
- Umbenannte Assets beim Kursabruf abbilden (z. B. `MATIC` → `POL` ab der Umstellung).
- Devisen: EZB-Referenzkurse, fehlende Tage mit dem letzten Fixing auffüllen; Stichtagskurs =
  letztes Fixing ≤ 31.12. Für die Deklaration durch den ESTV-Wert ersetzbar (Parameter).
- Jede Position nennt ihre **Mengenquelle** und **Kursquelle**. Ohne Kurs: Position bleibt,
  Wert leer, Status „Kurs/Menge fehlt“ (gelb), zählt als offener Punkt.

## Ertrag

### Binance (Transaktionshistorie)

- Zeitstempel der Historie sind in der **Export-Zeitzone** (Dateiname `…_UTC_2_…` ⇒ UTC+2) – nach
  UTC umrechnen.
- Ertrag „Zinsen/Staking“: `Simple Earn Flexible Interest`, `Simple Earn Locked Rewards`,
  `BNB Vault Rewards`.
- Ertrag „Airdrop/Launchpool“: `Simple Earn Flexible Airdrop`, `HODLer Airdrops Distribution`,
  `Launchpool Airdrop - System Distribution`, `Launchpool Airdrop - User Claim Distribution`,
  `Airdrop Assets`, `Distribution`. **Annahme:** Launchpool-/HODLer-Airdrops sind Ertrag
  (konservativ).
- Kein Ertrag: `Subscription`, `Redemption`, `Transfer Between …` (interne Umbuchungen),
  Token-Swaps/Redenominationen (z. B. `BTT` → `BTTC` als `Airdrop Assets` gebucht), Asset
  Recovery, Käufe.
- Bewertung: Menge × USD-Tageskurs (Zuflusstag, UTC) × USD/CHF des Tages.

### Binance Earn-Lücke (Differenzmethode)

Die Historie enthält nur Spot/Funding; in Earn intern gutgeschriebene Erträge fehlen.

- Je Jahr und Asset: **Lücke = (Bestand Ende − Bestand Anfang) − Σ Historie im Jahr** (ohne
  interne Umbuchungen). Bestand aus den Account Statements; Anfang = Ende des Vorjahres-Statements.
- Bewertung zum **Jahresmittel** (Ø der Tageskurse USD × USD/CHF im Jahr).
- Nur **positive** Lücken zählen als Ertrag; negative werden als Prüfhinweis ausgewiesen.
- EUR und USDT ausgenommen.

### Kraken (Ledger)

- Ertrag: `type = earn` mit `subtype ∈ {reward, airdrop}` sowie `type = staking`.
- Kategorie: `reward` → Earn Reward (Zinsen/Staking), `airdrop` → Airdrop, `staking` →
  Staking (on-chain).
- Bewertung: Krakens USD-Zeitwert der Buchung (`amountusd`) **netto** nach Gebühr (`− feeusd`) ×
  USD/CHF des Tages. Brutto vor Gebühr als Info ausweisen (nicht im Total). **Annahme:** netto
  ist der deklarierte Wert.
- Kein Ertrag: `allocation`, `autoallocation`, `transfer` (Umbuchungen).

### Bitfinex (Ledger)

- Ertrag: Beschreibungen mit `Staking reward`. Datumsformat `dd-mm-YYYY HH:MM:SS`.

### Einmalereignisse

- Hardforks und Airdrops (z. B. Fork-Coins, Airdrops an Halter eines Assets) separat ausweisen:
  Datum, Ereignis, Plattform, Asset, Menge, Wert zum Zuflusszeitpunkt.
- Ohne Kurs: Wert 0 mit Hinweis „ESTV-Kurs nachtragen“ (offener Punkt).

### Spam

- Token mit „Claim“ im Namen und andere Spam-/Scam-Token werden ausgeblendet (überschreibbar).

## Prüfungen

- Kraken: Ledger-Saldo per 31.12. = Saldo laut Account Statement Dezember, **alle Assets exakt**.
- Binance: Earn-Lücke ausgewiesen; Anfangsbestand = Endbestand des Vorjahres.
- Positionen ohne Kurs gezählt; Wallets auf allen Netzwerken geprüft.

## Auszug (Excel, ausführlich)

Blätter: **Übersicht**, **Parameter**, **Bestand 31.12.**, **Ertrag Detail**, **Earn-Lücke
Binance**, **Einmalereignisse**, **Offene Punkte**, **Methodik**.

- Farben: **blau** = Eingabe, **schwarz** = Formel, **grün** = Verweis auf Parameter, **gelb** =
  zu prüfen/nachzutragen.
- Parameter: USD/CHF und EUR/CHF per 31.12. als Eingabe; Ersatz durch ESTV-Werte rechnet alles neu.
- Bestand: Spalten Jahr, Plattform, Asset, Menge, Kurs USD, USD/CHF, Kurs CHF direkt,
  ESTV-Kurs (Override), Wert CHF, Status, Quelle Menge, Quelle Kurs. Wert CHF als Formel nach der
  Kurs-Rangfolge oben.
- Ertrag Detail: Datum (UTC), Plattform, Art, Kategorie, Asset, Menge netto, Kurs USD, Wert USD
  (Formel), USD/CHF Tag, Wert CHF (Formel), Referenz.
- Übersicht: Vermögen je Plattform (SUMIFS), Total, Anzahl Positionen ohne Kurs; Ertrag je
  Quelle/Kategorie, Total; Hinweise.
- Offene Punkte: Thema, Beschreibung, geschätzte Auswirkung CHF.
