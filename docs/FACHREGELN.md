# Fachregeln – Schweiz, Privatvermögen

Abgeleitet aus der bisherigen manuellen Auswertung (Steuerjahr 2025). Hier stehen nur **Regeln**;
Werte, Adressen und Mengen gehören nicht ins Repo (siehe CLAUDE.md, Private data). Keine
Steuerberatung – Zweifelsfälle sind als **Annahme** markiert und gehören in die offenen Punkte
(intern, nie in den Auszug für die Steuerbehörde).

Plattformspezifisches (Spalten, Buchungsarten, Asset-Namen, Zeitzonen) wird **nicht im Code**
umgesetzt, sondern in Mapping-JSONs (ANFORDERUNGEN F5.11); die Abschnitte zu einzelnen
Plattformen beschreiben, was diese Mappings ausdrücken müssen.

## Grundsatz

- Deklariert werden **Vermögen per 31.12.** (Wertschriftenverzeichnis) und **Ertrag** des Jahres
  (Einkommen aus beweglichem Vermögen). Kapitalgewinne im Privatvermögen sind steuerfrei und
  werden nicht ausgewiesen.
- Bewertung in CHF (Steuerwährung des Projekts, ANFORDERUNGEN F4.1a: Vorgabe aus dem Land,
  Schweiz → CHF; siehe „Kurse in einer anderen Steuerwährung“). Ertrag zum Zuflusszeitpunkt
  (Tageskurs), Vermögen zum Stichtag 31.12.

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
- EVM im Detail (Umsetzung): eine fehlgeschlagene Tx bewegt keinen Wert, ihr Gas ist aber bezahlt
  → Gebühr-Buchung (nur Gas). Auf Optimism/Base ist die L1-Datengebühr nicht in
  `gasUsed × gasPrice` enthalten (kleine Abweichung möglich, beim Abruf vermerkt). **Annahme**,
  im Zweifel mit dem Saldo laut Explorer abgleichen.
- Bitcoin: je Transaktion Σ Ausgänge an eigene Adressen − Σ Eingänge von eigenen Adressen; hat die
  Wallet bezahlt, ist die Netzwerkgebühr ihre Gebühr. Bei xpub/ypub/zpub zählen alle abgeleiteten
  Empfangs- und Wechselgeld-Adressen (Gap-Limit 20).
- Cardano, Polkadot: Staking-Erträge werden abgerufen (Ertrag am Beginn der Epoche, in der sie
  verfügbar wurden); Saldo per 31.12. manuell mit Beleg. Cosmos: alles manuell mit Beleg.
- Spam (ausgeblendet, überschreibbar „kein Spam“): Name mit „Claim“, Webadresse o. Ä.; nur
  Transfers mit Wert 0; Absender ähnelt einer eigenen Zieladresse (Adress-Vergiftung);
  unverifizierte, nur erhaltene Token; kopiertes Kürzel bekannter Token. Spam-Token erscheinen als
  `SPAM:<Kürzel>`, damit ein falscher „USDT“ die echte Position nicht berührt.

## Kurse

Rangfolge je Position (erste vorhandene gilt):

1. **ESTV-Kurs** (Kursliste, automatisch bezogen oder manuell importiert; Override geht vor) –
   CHF je Einheit per 31.12., Quelle „ESTV-Kursliste <Jahr>, Stand <Datum>“
2. **Kurs CHF direkt** – z. B. aus dem Kraken Account Statement (CHF-Bewertung per Stichtag)
3. **Kurs USD × USD/CHF** des Stichtags

- Stablecoins (`USDT`, `USDC`, `BUSD`, `FDUSD`, `USDD`) und `USD` = 1 USD. `CHF` = 1. `EUR` über
  EUR/CHF des Stichtags.
- USD-Kurse: Binance-Tagesschluss (Kline `1d`, Close, UTC) Paar `<SYM>USDT`, sonst `<SYM>BUSD`;
  letzter Kurs ≤ Datum, höchstens **14 Tage** alt, sonst erster Kurs danach (≤ 14 Tage); sonst
  kein Kurs. Weitere Quellen: Börsen-Kerzen (Kraken/Bitfinex), CoinGecko.
- Umbenannte Assets beim Kursabruf abbilden (z. B. `MATIC` → `POL` ab der Umstellung).
- Devisen per 31.12.: **zuerst der ESTV-Jahresendkurs** (USD, EUR aus der Kursliste, Quelle
  „ESTV-Kursliste <Jahr>, Stand <Datum>“); fehlt er, das letzte EZB-Fixing ≤ 31.12. Alle anderen
  Tage: EZB-Referenzkurse, fehlende Tage mit dem letzten Fixing auffüllen.
- Jede Position nennt ihre **Mengenquelle** und **Kursquelle**. Ohne Kurs: Position bleibt mit
  Menge, Wert leer, Status „ohne Kurswert“, Fussnote „Kein Kurswert verfügbar; nicht im Total
  enthalten.“; intern zählt sie als offener Punkt (Prüfbericht).

### Kurse in einer anderen Steuerwährung (F4.1a)

Ist die Steuerwährung T nicht CHF (z. B. EUR), gilt dieselbe Rangfolge in T:

1. **Override** in T (überschriebener Kurs) – die ESTV-Kursliste gilt **nicht** (sie ist in CHF).
2. **Kurs in T direkt** (CoinGecko in T); ein CHF-Kurs aus dem Beleg wird nicht verwendet.
3. **Kurs USD × USD/T** des Tages (Binance-Tagesschluss, USD-Wert der Plattform).

- Stablecoins und `USD` = 1 USD × USD/T; T selbst = 1; andere Währungen über ihren Kurs in T.
- Devisen: EZB-Referenzkurse USD → T und EUR → T (Frankfurter), letztes Fixing ≤ Tag, fehlende
  Tage aufgefüllt. Fehlt ein Paar, wird über USD, EUR oder CHF gekreuzt (z. B. CHF/EUR =
  1 / EUR/CHF; GBP/EUR = GBP/USD × USD/EUR).
- Earn-Lücke: Jahresmittel der Tageskurse USD × USD/T.
- Auszüge: alle Spalten und Summen in T („Wert EUR“), Parameter USD/T und EUR/T.
- Eine Änderung der Steuerwährung macht die Berechnung veraltet; Kurse neu laden und neu
  berechnen. Das Dashboard summiert nie über Währungen: es zeigt je Währung deren Projekte.

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
- Nur **positive** Lücken zählen als Ertrag; negative stehen im Auszug als „negativ – kein
  Ertrag“ und im internen Prüfbericht als Warnung.
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
- Ohne Kurs: Wert leer („–“) mit der Fussnote „Kein Kurswert verfügbar; nicht im Total
  enthalten.“; intern ein offener Punkt (Kurs nachtragen) im Prüfbericht.

### Spam

- Token mit „Claim“ im Namen und andere Spam-/Scam-Token werden ausgeblendet (überschreibbar).

## Prüfungen

- Kraken: Ledger-Saldo per 31.12. = Saldo laut Account Statement Dezember, **alle Assets exakt**.
- Binance: Earn-Lücke ausgewiesen; Anfangsbestand = Endbestand des Vorjahres.
- Positionen ohne Kurs gezählt; Wallets auf allen Netzwerken geprüft.

## Auszug (Excel, ausführlich)

Der Auszug geht an die **Steuerbehörde**: Er enthält nur, was deklariert wird, und wie es
berechnet wurde – **keine offenen Punkte, Prüfhinweise oder Arbeitsanweisungen** (kein „zu
prüfen“, kein „nachtragen“, keine Prüf-Farbe). Was zu klären ist, steht im **internen
Prüfbericht** (unten).

Blätter: **Übersicht**, **Parameter**, **Bestand 31.12.**, **Ertrag Detail**, **Earn-Lücke**,
**Einmalereignisse**, **Methodik**.

- Farben: **blau** = Eingabe, **schwarz** = Formel, **grün** = Verweis auf Parameter.
- Ohne Kurs: Menge steht, Wert leer, Status „ohne Kurswert“, Fussnote unter der Tabelle „Kein
  Kurswert verfügbar; nicht im Total enthalten.“ (Spam und negative Salden ebenso mit Fussnote).
- Parameter: USD/CHF und EUR/CHF per 31.12. als Eingabe; Ersatz durch ESTV-Werte rechnet alles neu.
- Bestand: Spalten Jahr, Plattform, Asset, Menge, Kurs USD, USD/CHF, Kurs CHF direkt,
  ESTV-Kurs (Override), Wert CHF, Status, Quelle Menge, Quelle Kurs. Wert CHF als Formel nach der
  Kurs-Rangfolge oben.
- Ertrag Detail: Datum (UTC), Plattform, Art, Kategorie, Asset, Menge netto, Kurs USD, Wert USD
  (Formel), USD/CHF Tag, Wert CHF (Formel), Referenz.
- Übersicht: Vermögen je Plattform (SUMIFS), Total, Anzahl Positionen ohne Kurswert (nicht im
  Total); Ertrag je Quelle/Kategorie, Total; Formularverweis und Farblegende.
- Earn-Lücke: erklärt die Differenzmethode (Formel, nur positive Lücken, Jahresmittel) – sie ist
  Ertrag, kein offener Punkt.
- Der einfache Auszug (PDF/Excel) hat dieselbe Regel: Verzeichnis, Ertrag, Fussnote für
  Positionen ohne Kurswert (mit Menge), Formularverweis.

## Interner Prüfbericht

„Interner Prüfbericht – nicht für die Steuerbehörde“ (PDF und Excel), für den Benutzer und den
Treuhänder: Prüfungen mit Ampel, alle offenen Punkte mit Erledigt-Status, Notiz und geschätzter
Auswirkung CHF, Positionen/Erträge/Einmalereignisse ohne Kurs, Warnungen zur Earn-Lücke (negativ,
ohne Jahresmittelkurs), Hinweise auf fehlende Dateien. Wird nie standardmässig an die Mail an den
Treuhänder angehängt; die offenen Fachfragen stehen im Mail-Text.
