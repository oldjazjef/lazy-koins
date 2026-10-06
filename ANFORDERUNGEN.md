# lazy-koins – Funktionale Anforderungen

lazy-koins erstellt aus Exporten von Krypto-Börsen und Wallets die Steuerunterlagen eines Steuerjahres: Vermögen per 31.12. und Ertrag, als einfacher und ausführlicher Auszug. Erstes Land: Schweiz (Privatvermögen). Fachregeln: `docs/FACHREGELN.md`.

## 1. Betriebsarten

- **F1.1** Web-App: im Browser nutzbar, mehrere Benutzer, jeder sieht nur seine Daten.
- **F1.2** Lokal: als Desktop-App auf macOS und Windows, ein Benutzer, ohne Login, Daten nur auf dem eigenen Rechner. Gleicher Funktionsumfang wie die Web-App.
- **F1.3** Ein Projekt lässt sich zwischen den Betriebsarten exportieren und importieren (Paket mit Daten und Originaldateien).
- **F1.4** Jedes Release (vX.Y.Z, erstellt wie beim Produktions-Deploy – per „Run workflow“
  oder von Hand veröffentlicht) baut die Desktop-App automatisch in der CI für **Windows**
  (Installer `.exe`) und **macOS** (`.dmg`, Apple Silicon und Intel) und hängt die Dateien an
  das GitHub-Release. Von dort lassen sie sich herunterladen und lokal installieren/ausführen.
  Versionsnummer der App = Release-Tag. Solange nicht signiert wird (offene Entscheidung), steht
  in den Release-Notes, wie man die Warnung von Windows SmartScreen bzw. macOS Gatekeeper
  bestätigt.

## 2. Benutzer (nur Web-App)

- **F2.1** Registrieren, Anmelden, Abmelden, Passwort zurücksetzen.
- **F2.2** Konto löschen inkl. aller Daten und Dateien.
- **F2.3** Alle Daten eines Benutzers als Paket herunterladen.

## 3. Speicherort und Cloud

- **F3.1** Lokal: Speicherort für Daten und Dateien wählen, auch den Sync-Ordner von OneDrive, Google Drive oder Proton Drive.
- **F3.2** Web-App: OneDrive und Google Drive verbinden; Originaldateien und Exporte werden dann zusätzlich dort in einer Ordnerstruktur abgelegt (Projekt / Plattform / Datei).
- **F3.3** Speicherort bzw. Verbindung jederzeit ändern oder trennen.
- **F3.4** Warnung bei Sync-Konflikten oder gleichzeitiger Bearbeitung auf zwei Geräten.

## 4. Projekte

- **F4.1** Ein Projekt = ein Steuerjahr (z. B. „Steuern 2025“). Angaben: Name, Jahr, Land, Kanton, Status (in Arbeit / geprüft / abgeschlossen), Notizen.
- **F4.2** Projektliste mit Status, Vermögen und Ertrag je Projekt.
- **F4.3** Neues Projekt anlegen; Land, Kanton und Wallets werden aus dem neusten Projekt vorgeschlagen.
- **F4.4** Aus älteren Projekten übernehmen: Dateien, Wallets und Korrekturen auswählen, gruppiert nach Plattform/Wallet. Eine übernommene Datei wird nicht doppelt gespeichert.
- **F4.5** Abgeschlossene Projekte sind schreibgeschützt; Entsperren mit Bestätigung.
- **F4.6** Projekt umbenennen, archivieren, löschen (mit Bestätigung).

## 5. Dateien

- **F5.1** Upload per Drag & Drop oder Dateiauswahl, mehrere Dateien gleichzeitig (CSV, XLSX, PDF).
- **F5.2** Dateien werden über das Standardformat (F5.9) oder ein passendes Mapping (F5.11) erkannt – keine plattformspezifischen Parser im Code. Die Exporte von mindestens Kraken (Ledger, Kontoauszug), Binance (Transaktions-, Ein- und Auszahlungshistorie, Account Statement), Bitfinex (Ledger), Bittrex (Transaction/Order History) und Revolut (Krypto-Kontoauszug) müssen so einlesbar sein. Ohne passendes Mapping: Mapping per AI (F5.13) oder manuell erstellen, oder als „nur Beleg“ markieren.
- **F5.3** Originaldateien bleiben unverändert erhalten und sind jederzeit herunterladbar.
- **F5.4** Doppelte Uploads werden erkannt und abgelehnt bzw. verknüpft.
- **F5.5** Dateiübersicht gruppiert nach Plattform/Wallet mit Typ, erkanntem Zeitraum, Anzahl Buchungen, Upload-Datum und Herkunft (neu / aus Projekt X).
- **F5.6** Vorschau einer Datei (Tabelle bzw. PDF-Seiten).
- **F5.7** Datei aus Projekt entfernen; endgültig gelöscht wird sie erst, wenn kein Projekt sie mehr nutzt.
- **F5.8** Fehlende Dateien anzeigen, z. B. „Kraken-Kontoauszug Dezember fehlt“ oder „Binance-Historie endet am 30.06.“, mit Anleitung, wo der Export zu finden ist.

## 5a. Standardformat, Mappings und AI-Umwandlung

Entscheid 06.10.2026: **keine plattformspezifischen Parser** im Code (Wartungsaufwand). Alle
Exporte werden über das Standardformat oder über ein **Mapping (JSON)** eingelesen.

- **F5.9** Standardformat „lazy-koins Buchungen“ als Vorlage in der App herunterladbar (CSV und
  Excel). Excel mit Erklärungsblatt, Beispielzeilen und Auswahllisten. Zwei Teile:
  **Buchungen** (Datum mit Zeitzone, Plattform/Wallet, Art, Asset, Menge, Gebühr, Gebühr-Asset,
  optional Kurs CHF/USD, Referenz, Notiz) und **Bestände per Stichtag** (Plattform/Wallet,
  Asset, Menge, Stichtag, optional Kurs, Beleg).
- **F5.10** Eine befüllte Vorlage wird wie jeder andere Export hochgeladen, erkannt und geprüft;
  Fehler werden pro Zeile angezeigt.
- **F5.11** Mapping: eine JSON-Datei, die beschreibt, wie ein beliebiger Export (CSV/XLSX) ins
  Standardformat übersetzt wird (Kopfzeile, Spalten, Datumsformat, Zeitzone, Vorzeichen,
  Gebühren, Arten, Asset-Schreibweisen, Filter). Die App wendet es deterministisch an; jede
  Buchung verweist auf die Zeile der Originaldatei (F7.5).
- **F5.12** Mappings sind **im Projekt sichtbar** (Name, Plattform, Herkunft AI/manuell, welche
  Dateien es nutzen), als JSON einsehbar, herunter- und hochladbar und bearbeitbar. Eine neue
  Datei mit gleichem Aufbau (Fingerabdruck) wird automatisch mit dem passenden Mapping
  eingelesen – **ohne AI**.
- **F5.13** AI-Plugin: ein beliebiger Anbieter lässt sich anbinden (OpenAI-kompatible API – z. B.
  OpenAI, Mistral, Groq, lokal Ollama/LM Studio – sowie Anthropic), konfiguriert in den
  Einstellungen (Anbieter, Adresse, Modell, API-Schlüssel). Für eine Datei ohne passendes Mapping
  erstellt die AI das **Mapping**, nicht die Buchungen; nach Vorschau und Bestätigung wird es
  gespeichert und künftig wiederverwendet (spart Tokens).
- **F5.14** Datenschutz: Vor dem ersten Senden an einen externen Anbieter ausdrückliche
  Zustimmung; es wird angezeigt, was gesendet wird (Kopfzeile + wenige Beispielzeilen).
  AI-Nutzung ist ein-/ausschaltbar; ohne AI funktioniert alles mit Vorlage und Mappings.

## 6. Wallets

- **F6.1** Wallet-Adressen erfassen mit Bezeichnung und Netzwerken.
- **F6.2** Seed-Phrasen oder private Schlüssel werden erkannt und abgelehnt, mit Warnhinweis.
- **F6.3** Bestände per 31.12. und Erträge werden für unterstützte Netzwerke automatisch abgerufen.
- **F6.4** Prüfung, auf welchen Netzwerken eine Adresse je genutzt wurde.
- **F6.5** Für nicht abrufbare Netzwerke: Saldo manuell erfassen und Beleg anhängen.
- **F6.6** Spam-/Scam-Tokens werden erkannt und ausgeblendet; manuell überschreibbar.
- **F6.7** Benötigte API-Schlüssel (z. B. Etherscan) in den Einstellungen hinterlegen.

## 7. Berechnung

- **F7.1** Bestand per 31.12. je Plattform/Wallet und Asset, bewertet in CHF.
- **F7.2** Ertrag des Jahres je Kategorie (Zinsen/Earn, Staking, Airdrop, Launchpool, Hardfork), bewertet zum Zuflusszeitpunkt in CHF.
- **F7.3** Einmalereignisse (Hardforks, Airdrops, Verluste) separat ausweisen.
- **F7.4** Kurse automatisch ermitteln mit Angabe der Quelle; Stichtags-Wechselkurse je Projekt einsehbar und überschreibbar (z. B. ESTV-Kursliste).
- **F7.5** Jede Zahl ist bis zur Buchung in der Originaldatei rückverfolgbar (Klick auf Betrag → zugrunde liegende Buchungen → Quelldatei und Zeile).
- **F7.6** Neuberechnung jederzeit per Knopfdruck; gleiche Daten ergeben gleiches Ergebnis.
- **F7.7** Landesregeln sind austauschbar; zunächst nur Schweiz wählbar.

## 8. Prüfungen

- **F8.1** Prüf-Übersicht mit Ampel je Prüfung, mindestens: Börsensaldo laut Ledger = Saldo laut Kontoauszug · fehlende Earn-Erträge (Binance) ausgewiesen · Auszahlungen ohne Gegenbuchung · Zuflüsse ohne Gegenbuchung (möglicher Ertrag) · Anfangsbestand = Endbestand des Vorjahres · Positionen ohne Kurs · Wallets auf allen Netzwerken geprüft.
- **F8.2** Offene Punkte mit geschätzter Auswirkung in CHF, abhakbar, mit Notiz.
- **F8.3** Vergleich mit dem Vorjahresprojekt (Vermögen, Ertrag, neue/weggefallene Positionen).

## 9. Korrekturen

- **F9.1** Kurs einer Position überschreiben.
- **F9.2** Buchung umklassieren: Ertrag / kein Ertrag / Spam / Verlust / Transfer.
- **F9.3** Manuelle Position oder Buchung erfassen (z. B. Hardfork, Verlust, vergessene Plattform).
- **F9.4** Jede Korrektur mit Begründung, Datum, Vorher/Nachher; Verlauf einsehbar; rückgängig machbar.

## 10. Exporte

- **F10.1** Einfacher Auszug als PDF (1–2 Seiten) und Excel: Steuerwert per 31.12., Ertrag, Wertschriftenverzeichnis mit einer Zeile pro Plattform/Wallet (Hauptpositionen, Anzahl Kleinpositionen, Steuerwert), Ertragstabelle, offene Punkte.
- **F10.2** Ausführlicher Auszug als Excel und PDF: Übersicht, Parameter, Bestand je Position mit Kursquelle, Ertrag je Buchung, fehlende Earn-Erträge, Einmalereignisse, Prüfungen, offene Punkte, Methodik. Excel mit nachvollziehbaren Formeln; Eingaben und fehlende Werte farblich markiert; überschriebene Kurse rechnen im Excel weiter.
- **F10.3** Bezeichnungen und Formularverweise passend zum gewählten Land und Kanton.
- **F10.4** Kopfzeile mit Name, Steuerjahr, Kanton, Erstellungsdatum und Hinweis „keine Steuerberatung“.
- **F10.5** Alle Exporte werden im Projekt mit Datum gespeichert und bleiben abrufbar.
- **F10.6** Mail-Entwurf an den Treuhänder (Name hinterlegbar) mit den zwei Werten, Anhängen-Liste und offenen Fachfragen; Text zum Kopieren.

### Datenexport

- **F10.7** Buchungen und Bestände eines Projekts (alle oder gefiltert nach Plattform/Wallet,
  Asset, Art, Zeitraum) als CSV und Excel im **Standardformat** (F5.9) – mit angewendeten
  Korrekturen, verwendeten Kursen und Kursquelle sowie Verweis auf Quelldatei und Zeile. Die
  Datei lässt sich unverändert wieder importieren.
- **F10.8** Projekt-Paket (ZIP): Originaldateien, Mappings, Korrekturen mit Verlauf, Kurse,
  Prüf-Notizen, erstellte Auszüge und eine Beschreibung des Inhalts (Manifest mit Version und
  SHA-256 je Datei). Importierbar in Web-App und Desktop-App (= F1.3); beim Import werden
  bereits vorhandene Dateien nicht doppelt gespeichert (F4.4).
- **F10.9** Konto-Paket (ZIP): alle Projekte als Projekt-Pakete plus Mappings und Einstellungen
  (ohne API-Schlüssel) – zum Herunterladen aller Daten eines Benutzers (= F2.3, Auskunft nach
  DSG/DSGVO) und zum Umzug in die Desktop-App.

## 11. Profil und Einstellungen

Alles Projektübergreifende lebt an zwei Orten, erreichbar über das Benutzermenü oben rechts:

- **F11.0a Profil** – die Person und das Konto: persönliche Angaben (F11.1), Sprache (F11.2),
  Zahlen- und Datumsformat; in der Web-App zusätzlich E-Mail/Passwort ändern, Abmelden, alle
  Daten herunterladen (F10.9 / F2.3) und Konto löschen (F2.2). Desktop: ohne Konto-Teil.
- **F11.0b Einstellungen** – app-weite Konfiguration, in Abschnitte gegliedert:
  **Mappings** (alle Mappings des Benutzers, projektübergreifend: auflisten, ansehen,
  bearbeiten, löschen, herunter-/hochladen, „wird genutzt in“ Projekt/Datei; ein in einem
  Projekt erstelltes Mapping steht in allen Projekten zur Verfügung), **AI** (Anbieter, Modell,
  Schlüssel, Zustimmung, F5.13/F5.14), **Kurse** (Internet-Kurse ein/aus F11.3, CoinGecko-Schlüssel,
  ESTV-Kursliste), **Wallets/Netzwerke** (API-Schlüssel wie Etherscan, F6.7), **Speicherort**
  (Desktop, F3.1) und **Cloud-Verbindungen** (Web, F3.2). Schlüssel werden nie wieder angezeigt
  (nur die letzten Zeichen).
- Im Projekt bleiben nur projektbezogene Dinge (Dateien, die im Projekt genutzten Mappings mit
  Link in die Einstellungen, Kurse/Overrides des Projekts, Ergebnis, Prüfungen, Korrekturen,
  Exporte).

- **F11.1** Persönliche Angaben für die Exporte (Name, Wohnkanton, Treuhänder).
- **F11.2** Sprache, Zahlen- und Datumsformat. Die App ist vollständig übersetzbar; zunächst
  **Deutsch (Schweiz)** und **Englisch**. Die Sprache wird im Benutzerprofil eingestellt und
  gespeichert (Web: am Benutzer; Desktop: lokal) und gilt sofort, ohne Neuladen. Vorgabe beim
  ersten Login: Browsersprache, sonst Deutsch. Exporte erscheinen in der eingestellten Sprache;
  steuerliche Fachbegriffe und Formularverweise kommen aus den Landesregeln (F10.3). Weitere
  Sprachen = eine neue Übersetzungsdatei.
- **F11.3** Kursabfragen aus dem Internet ein-/ausschaltbar.

## 11a. Dashboard

Übersicht über das gesamte Krypto-Vermögen, ähnlich Koinly – **ohne** Einstandswert, ROI und
realisierte/unrealisierte Gewinne (Kapitalgewinne sind nicht im Umfang).

- **F11.4** Startseite nach dem Login: Dashboard über **alle Projekte** eines Benutzers mit frei
  wählbarem Zeitraum (Vorgabe: 01.01. des laufenden Jahres bis heute; Schnellwahl Steuerjahre).
  Zusätzlich eine kompakte Version je Projekt für dessen Steuerjahr.
- **F11.5** Gesamtwert in CHF zum Ende des Zeitraums mit Veränderung in % gegenüber dem Beginn,
  und Verlauf als Liniendiagramm (Tageswerte = Bestände × Tageskurs).
- **F11.6** Kennzahlen im Zeitraum: Einzahlungen (In), Auszahlungen (Out), Ertrag (mit Anteil am
  Vermögen in %), Kosten/Verluste, Handelsgebühren – jeweils in CHF, anklickbar bis zu den
  Buchungen (wie F7.5).
- **F11.7** Verteilung nach Asset als gestapelter Balken (grösste Positionen benannt, Rest
  zusammengefasst).
- **F11.8** Bestände-Tabelle: Asset, Menge, Kurs CHF je Einheit, Marktwert CHF, Kursverlauf im
  Zeitraum (Sparkline); sortier- und durchsuchbar; aufklappbar nach Plattform/Wallet;
  Stichtag wählbar.
- **F11.9** Werte stammen aus denselben Daten und Kursen wie die Steuerberechnung (keine zweite
  Rechnung); fehlende Kurse werden als solche markiert, nicht als 0 dargestellt. Ohne
  Internet-Kurse (F11.3) zeigt das Dashboard nur gespeicherte Kurse.

## 12. Abnahme

- **A1** Mit den echten Daten (lokal in `private/`, Sollwerte in `private/golden.json`) ergibt das Projekt 2025 dieselben Werte wie die manuelle Auswertung (±0.05 CHF); der Kraken-Saldo per 31.12.2025 stimmt exakt mit dem Kontoauszug überein.
- **A2** Ein Benutzer kann ohne technische Kenntnisse ein Projekt anlegen, Dateien hochladen, die Prüfungen einsehen, Korrekturen erfassen und beide Auszüge exportieren – in der Web-App und in der lokalen App.

## Nicht im Umfang (vorerst)

Kapitalgewinnberechnung und andere Länder als CH · direkte Börsen-APIs · E-Steuerauszug eCH-0196 · Mobile App.
