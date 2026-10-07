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

- **F4.1** Ein Projekt = ein Steuerjahr (z. B. „Steuern 2025“). Angaben: Name, Jahr, Land, Kanton, **Steuerwährung**, Status (in Arbeit / geprüft / abgeschlossen), Notizen.
- **F4.1a Steuerwährung**: Pro Projekt wird die Währung festgelegt, in der Vermögen und Ertrag
  bewertet und ausgewiesen werden (Vorgabe aus dem Land: Schweiz → CHF; änderbar, z. B. EUR).
  Alle Bewertungen, Kurse (Krypto → Steuerwährung, Devisen über EZB/ESTV), Prüfungen, Exporte,
  Dashboard-Werte und Mail-Platzhalter verwenden diese Währung; Spalten- und Feldnamen zeigen sie
  („Wert CHF“ → „Wert <Währung>“). Die ESTV-Kursliste gilt nur für CHF; bei anderer Währung
  greifen die übrigen Quellen bzw. die Landesregeln (F7.7). Eine Änderung der Währung verlangt
  eine Bestätigung und eine Neuberechnung.
  Präzisiert (08.10.2026): wählbar sind die Währungen mit EZB-Referenzkursen (CHF, EUR, USD, GBP,
  …); Devisen USD/EUR → Steuerwährung von der EZB, fehlende Paare über Kreuzkurse. Das Dashboard
  rechnet Projekte verschiedener Währungen nicht um: es zeigt je Währung deren Projekte (Auswahl
  mit Hinweis). Pakete ohne Angabe gelten als CHF.
- **F4.2** Projektliste mit Status, Vermögen und Ertrag je Projekt.
- **F4.3** Neues Projekt anlegen; Land, Kanton und Wallets werden aus dem neusten Projekt vorgeschlagen.
- **F4.4** Aus älteren Projekten übernehmen: Dateien, Wallets und Korrekturen auswählen, gruppiert nach Plattform/Wallet. Eine übernommene Datei wird nicht doppelt gespeichert.
- **F4.4a Folgeprojekt erstellen**: In einem Projekt per Knopf „Folgeprojekt erstellen“ ein
  Projekt für das nächste Steuerjahr anlegen (Name, Jahr = Vorjahr + 1, Land und Kanton
  vorbelegt und änderbar). Ein Dialog zeigt, was übernommen werden kann, als **Checkboxen**
  (gruppiert, mit „alle/keine“ je Gruppe und einer Zusammenfassung, was übernommen wird):
  - **Dateien** je Plattform/Wallet einzeln wählbar, mit Hinweis auf ihren Zeitraum –
    vorausgewählt sind Dateien, deren Zeitraum ins neue Jahr reicht (z. B. ein Ledger bis heute);
    sie werden verknüpft, nicht kopiert (F4.4, F5.7).
  - **Wallets** (Adressen, Bezeichnung, Netzwerke) – vorausgewählt.
  - **Korrekturen**, die über das Jahr hinaus gelten (Umklassierungen von Buchungen, die auch im
    neuen Jahr vorkommen; manuelle Positionen ohne Stichtag) – einzeln wählbar, nicht
    vorausgewählt; jahresgebundene Korrekturen (Kurs-Overrides per 31.12.) werden nicht angeboten.
  - **Offene Punkte**, die noch nicht erledigt sind – als offene Punkte im neuen Projekt.
  - **Notizen** des Projekts.

  Immer automatisch: Endbestand per 31.12. des Vorjahres als Vergleichswert für die Prüfung
  „Anfangsbestand = Endbestand Vorjahr“ (F8.1) und den Vorjahresvergleich (F8.3). Mappings
  gelten ohnehin für alle Projekte (F11.0). Das Vorjahresprojekt bleibt unverändert; im neuen
  Projekt ist sichtbar, was woher übernommen wurde.

- **F4.5** Abgeschlossene Projekte sind schreibgeschützt; Entsperren mit Bestätigung.
- **F4.6** Projekt umbenennen, archivieren, löschen (mit Bestätigung).
- **F4.7 An Treuhänder gesendet**: Jedes Projekt zeigt, ob und wann die Unterlagen dem
  Treuhänder zugestellt wurden (Datum, Empfänger, Weg, welche Auszüge). Gesetzt wird der Status
  **automatisch** beim erfolgreichen Senden über „An Treuhänder senden“ (F10.6a) oder
  **manuell** („als gesendet markieren“ mit Datum, Weg – z. B. Mail, Post, persönlich – und
  Notiz; rückgängig machbar). Sichtbar als Abzeichen in der Projektliste und im Projekt; werden
  danach Daten geändert oder neue Auszüge erstellt, erscheint der Hinweis „seit dem Versand
  geändert“.

## 5. Dateien

- **F5.1** Upload per Drag & Drop oder Dateiauswahl, mehrere Dateien gleichzeitig (CSV, XLSX, PDF).
- **F5.2** Dateien werden über das Standardformat (F5.9) oder ein passendes Mapping (F5.11) erkannt – keine plattformspezifischen Parser im Code. Die Exporte von mindestens Kraken (Ledger, Kontoauszug), Binance (Transaktions-, Ein- und Auszahlungshistorie, Account Statement), Bitfinex (Ledger), Bittrex (Transaction/Order History) und Revolut (Krypto-Kontoauszug) müssen so einlesbar sein. Ohne passendes Mapping: Mapping per AI (F5.13) oder manuell erstellen, oder als „nur Beleg“ markieren.
- **F5.3** Originaldateien bleiben unverändert erhalten und sind jederzeit herunterladbar.
- **F5.4** Doppelte Uploads werden erkannt und abgelehnt bzw. verknüpft.
- **F5.5** Dateiübersicht gruppiert nach Plattform/Wallet mit Typ, erkanntem Zeitraum, Anzahl Buchungen, Upload-Datum und Herkunft (neu / aus Projekt X).
- **F5.6** Vorschau einer Datei (Tabelle bzw. PDF-Seiten).
- **F5.7** Datei aus Projekt entfernen; endgültig gelöscht wird sie erst, wenn kein Projekt sie mehr nutzt.
- **F5.8** Fehlende Dateien anzeigen, z. B. „Kraken-Kontoauszug Dezember fehlt“ oder „Binance-Historie endet am 30.06.“, mit Anleitung, wo der Export zu finden ist.
  - **Hinweise** als eigener Bereich im Projekt (Reiter mit Anzahl offener Hinweise; im
    Dateibereich nur eine kurze Zusammenfassung „7 Hinweise → anzeigen“): Tabelle mit **Typ**
    (Abzeichen mit Dringlichkeit Info/Warnung/Fehler: „Fehlende Datei“, „Lücke am Anfang“,
    „Lücke am Ende“, „Kein Bestand per 31.12.“, „Nicht erkannte Datei“, „Datei mit
    Zeilenfehlern“), Plattform/Konto, kurzer Beschreibung, Datum, **Status** (offen / erledigt /
    ignoriert) und **Aktion**; sortierbar, filterbar nach Typ und Status, nach Plattform
    gruppiert (einklappbar); die ausführliche Anleitung in einer aufklappbaren Zeile.
  - **Lösungen je Typ**: Datei hochladen (für die Plattform), Kontoauszug mit AI auslesen (wenn
    ein PDF der Plattform vorhanden ist), Bestand manuell erfassen (Korrektur, vorbelegt mit
    Plattform/Konto/31.12.), Vorlage herunterladen, Mapping zuordnen bzw. mit AI erstellen,
    Zeilenfehler ansehen; „Als in Ordnung markieren“ (mit Notiz, z. B. „Konto nach 09.02. nicht
    mehr genutzt“), „Ignorieren“ und „Wieder öffnen“. Der Status wird je Projekt gespeichert und
    bleibt nach einer Neuberechnung und neuen Dateien erhalten (stabiler Schlüssel je Hinweis).
  - **Keine unnötigen Hinweise**: ein Kontoauszug per 31.12. für die ganze Plattform (z. B. ein
    Kraken-Auszug über Spot- und Earn-Unterkonten) gilt für alle ihre Konten; gibt es gar keinen,
    erscheint **ein** Hinweis je Plattform statt einer je Konto. Enden die Buchungen eines Kontos
    vor dem 31.12. und ist sein Saldo danach 0, ist das nur eine Information (es kann nichts
    fehlen) und es braucht keinen Auszug per 31.12. — der Hinweis erklärt das.
  - Mit den Prüfungen (F8.1/F8.2) verknüpft, nicht doppelt: Dateiprobleme stehen nur bei den
    Hinweisen; offene Punkte verlinken auf die Hinweise ihrer Plattform und umgekehrt.

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

### Mapping-Bibliothek (nur Web-App)

Wunsch 08.10.2026: „Ich möchte, dass es eine globale Datenbank gibt (nur Web-Version), die
Mappings hält. Mappings können geratet werden. Man kann seine eigenen Mappings dort raufladen. Man
kann nur sein eigenes Mapping von dort löschen. Wenn jemand dieses Mapping in sein Projekt
verwendet, wird eine Kopie davon erstellt, damit beim globalen Löschen die User dieses Mapping
weiter verwenden können.“ Die Bibliothek gibt es nur in der Web-App (alle Benutzer eines Servers
teilen sie); in der Desktop-App fehlt sie ganz (kein Menüeintrag, die Schnittstelle antwortet 404).

- **F5.15 Veröffentlichen und Löschen**: Ein eigenes Mapping (Mapping-Seite „In Bibliothek
  veröffentlichen“) oder eine hochgeladene `.json` lässt sich in der Bibliothek veröffentlichen –
  erst nach einem **Prüfschritt**: angezeigt wird genau das JSON, das öffentlich wird; eine
  Datenschutz-Prüfung warnt vor Werten, die nach Konto-/Kundennummern, Wallet-Adressen, E-Mails,
  IBANs oder Namen aussehen (Filterwerte, Asset-Aliase, Konstanten, Dateinamen-Muster,
  Beschreibung) und bietet an, sie zu entfernen; veröffentlicht wird nur mit ausdrücklicher
  Bestätigung (verbleibende Hinweise müssen bewusst beibehalten werden). Der Autor erscheint nur
  unter einem selbst gewählten **Anzeigenamen** oder als „Anonym“ – nie mit E-Mail oder Namen
  aus dem Profil. Eine neue Version des eigenen Eintrags erhöht dessen Versionsnummer; wer eine
  ältere übernommen hat, behält seine Kopie (mit Hinweis „Neue Version verfügbar“). **Nur der
  Autor** kann seinen Eintrag löschen (für alle anderen gibt es ihn dann nicht – 404); gelöscht
  wird weich (für die Nachvollziehbarkeit), die Kopien bleiben unberührt. Schutz vor Missbrauch:
  Grössenlimit des JSON, Ratenlimits fürs Veröffentlichen und Bewerten, höchstens 10 neue
  Einträge pro Benutzer und Tag.
- **F5.16 Übernehmen = Kopie**: „Übernehmen“ legt immer eine **eigene Kopie** in den Mappings des
  Benutzers an (Herkunft `library:<Eintrag>@<Version>`); Projekte verwenden nur diese Kopie.
  Spätere Versionen oder das Löschen des Eintrags ändern sie nicht; die Kopie lässt sich wie jedes
  eigene Mapping bearbeiten und löschen. Braucht eine hochgeladene Datei ein Mapping und passen
  Bibliothekseinträge zu ihrem Fingerabdruck, zeigt der Dateibereich „In der Bibliothek gefunden:
  N passende Mappings“ mit „Übernehmen“ (Kopie + der Datei zuordnen) – vor dem AI-Angebot.
- **F5.17 Bibliothek und Bewertung**: Seite „Bibliothek“ als Unterpunkt von „Mappings“ im Hauptmenü (nur Web): suchen (Name,
  Plattform, Beschreibung), nach Plattform filtern, sortieren (Bewertung, Übernahmen, neueste,
  Name), Detailseite mit JSON, Version, Angaben und „Übernehmen“. Jeder Benutzer kann einen
  fremden Eintrag mit 1–5 Sternen bewerten (eine Bewertung pro Benutzer, änderbar, entfernbar;
  eigene Einträge nicht); angezeigt werden Durchschnitt und Anzahl. Chat und MCP haben dieselben
  Funktionen als Werkzeuge (suchen, ansehen, übernehmen, bewerten, eigenes veröffentlichen,
  eigenes löschen) – strikt auf den angemeldeten Benutzer beschränkt (F11.16).

## 6. Wallets

- **F6.1** Wallet-Adressen erfassen mit Bezeichnung und Netzwerken.
- **F6.2** Seed-Phrasen oder private Schlüssel werden erkannt und abgelehnt, mit Warnhinweis.
- **F6.3** Bestände per 31.12. und Erträge werden für unterstützte Netzwerke automatisch abgerufen.
- **F6.4** Prüfung, auf welchen Netzwerken eine Adresse je genutzt wurde.
- **F6.5** Für nicht abrufbare Netzwerke: Saldo manuell erfassen und Beleg anhängen.
- **F6.6** Spam-/Scam-Tokens werden erkannt und ausgeblendet; manuell überschreibbar.
- **F6.7** Benötigte API-Schlüssel (z. B. Etherscan) in den Einstellungen hinterlegen.

Umsetzung (Stand 08.10.2026): automatisch abgerufen werden Bitcoin (Adresse oder xpub/ypub/zpub),
die EVM-Netzwerke Ethereum, BNB Chain, Polygon, Arbitrum, Optimism, Base (Etherscan V2; was der
Plan des Schlüssels nicht abdeckt, wird manuell erfasst) und Solana; bei Cardano und Polkadot nur
die Staking-Erträge (Saldo per 31.12. manuell mit Beleg), Cosmos ganz manuell. Abgerufenes wird
als abgeleitete Datei im Standardformat Teil des Projekts.

## 7. Berechnung

- **F7.1** Bestand per 31.12. je Plattform/Wallet und Asset, bewertet in CHF.
- **F7.2** Ertrag des Jahres je Kategorie (Zinsen/Earn, Staking, Airdrop, Launchpool, Hardfork), bewertet zum Zuflusszeitpunkt in CHF.
- **F7.3** Einmalereignisse (Hardforks, Airdrops, Verluste) separat ausweisen.
- **F7.4** Kurse automatisch ermitteln mit Angabe der Quelle; Stichtags-Wechselkurse je Projekt einsehbar und überschreibbar (z. B. ESTV-Kursliste).
- **F7.4a ESTV-Kursliste automatisch**: Die Kursliste (ICTax) des Steuerjahres wird online
  bezogen (offizieller XML-Export, jeweils die neueste Fassung – die ESTV aktualisiert sie auch
  nach dem 31.03. noch) und daraus die Jahresendkurse für Kryptowährungen und Devisen
  übernommen; Quelle „ESTV-Kursliste <Jahr>, Stand <Datum>“. Einmal je Jahr und Stand
  heruntergeladen und gespeichert (nicht pro Benutzer), danach regelmässig auf neue Stände
  geprüft. Kryptowährungen ohne ESTV-Kurs fallen auf die übrigen Quellen zurück (F7.4).
  Respektiert „Kursabfragen aus dem Internet“ (F11.3); der manuelle Import bleibt als Ersatz.
  Präzisiert (08.10.2026): Prüfung täglich und beim Start (Desktop), Download nur bei neuerem
  Stand (anderer Datei-Hash, nicht älter); auf dem Server abschaltbar (`ESTV_AUTO=false`).
  Zuordnung über Kürzel, bekannte Umbenennungen und Namen; passen mehrere Einträge, wird **kein**
  ESTV-Wert übernommen (Hinweis: Kurs per 31.12. überschreiben). Die ESTV-Jahresendkurse USD und
  EUR gelten per 31.12. ebenfalls vor den EZB-Kursen. Ein neuer Stand wird mit „Kurse
  aktualisieren“ bzw. „Neuen Stand übernehmen“ ins Projekt übernommen; die Berechnung ist danach
  veraltet. Status (Stand je Jahr, letzte Prüfung, Fehler) unter Einstellungen › Kurse.
- **F7.5** Jede Zahl ist bis zur Buchung in der Originaldatei rückverfolgbar (Klick auf Betrag → zugrunde liegende Buchungen → Quelldatei und Zeile).
- **F7.6** Neuberechnung jederzeit per Knopfdruck; gleiche Daten ergeben gleiches Ergebnis.
- **F7.7** Landesregeln sind austauschbar; zunächst nur Schweiz wählbar.

## 8. Prüfungen

- **F8.1** Prüf-Übersicht mit Ampel je Prüfung, mindestens: Börsensaldo laut Ledger = Saldo laut Kontoauszug · fehlende Earn-Erträge (Binance) ausgewiesen · Auszahlungen ohne Gegenbuchung · Zuflüsse ohne Gegenbuchung (möglicher Ertrag) · Anfangsbestand = Endbestand des Vorjahres · Positionen ohne Kurs · Wallets auf allen Netzwerken geprüft.
- **F8.2** Offene Punkte mit geschätzter Auswirkung in CHF, abhakbar, mit Notiz. Fehlende oder
  fehlerhafte Dateien sind keine offenen Punkte, sondern Hinweise (F5.8): die Prüfungen zeigen
  die Zahl offener Hinweise mit Link, ein offener Punkt verlinkt auf die Hinweise seiner
  Plattform, ein Hinweis auf die offenen Punkte seines Kontos.
- **F8.3** Vergleich mit dem Vorjahresprojekt (Vermögen, Ertrag, neue/weggefallene Positionen).

## 9. Korrekturen

- **F9.1** Kurs einer Position überschreiben.
- **F9.2** Buchung umklassieren: Ertrag / kein Ertrag / Spam / Verlust / Transfer.
- **F9.3** Manuelle Position oder Buchung erfassen (z. B. Hardfork, Verlust, vergessene Plattform).
- **F9.4** Jede Korrektur mit Begründung, Datum, Vorher/Nachher; Verlauf einsehbar; rückgängig machbar.

## 10. Exporte

- **Grundsatz:** Auszüge für die Steuerbehörde (F10.1, F10.2) enthalten keine offenen Punkte, Prüfhinweise oder Arbeitsanweisungen – nur, was deklariert wird, und wie es berechnet wurde. Positionen und Ereignisse ohne Kurs erscheinen mit ihrer Menge, ohne Wert, mit einer neutralen Fussnote („Kein Kurswert verfügbar; nicht im Total enthalten.“).
- **F10.1** Einfacher Auszug als PDF (1–2 Seiten) und Excel: Kopfzeile (F10.4), Steuerwert per 31.12., Ertrag, Wertschriftenverzeichnis mit einer Zeile pro Plattform/Wallet (Hauptpositionen, Anzahl Kleinpositionen, Steuerwert), Ertragstabelle.
- **F10.2** Ausführlicher Auszug als Excel und PDF: Übersicht (Vermögen, Ertrag), Parameter (Devisenkurse), Bestand per 31.12. je Position mit Kurs und Kursquelle, Ertrag (Zusammenfassung und je Buchung), fehlende Earn-Erträge (Earn-Lücke, als Erläuterung der Differenzmethode), Einmalereignisse, Methodik. Excel mit nachvollziehbaren Formeln; Eingaben (blau), Formeln (schwarz) und Verweise auf Parameter (grün) farblich unterschieden; überschriebene Kurse rechnen im Excel weiter.
- **F10.2a** Interner Prüfbericht als PDF und Excel, deutlich betitelt „Interner Prüfbericht – nicht für die Steuerbehörde“: Prüfungen mit Ampel (F8.1), offene Punkte mit Erledigt-Status und Notiz (F8.2), Positionen/Erträge/Ereignisse ohne Kurs, Warnungen zur Earn-Lücke, Hinweise auf fehlende Dateien (F5.8). Wird im Tab Exporte separat erstellt, wie die Auszüge gespeichert (F10.5), aber in einer eigenen Gruppe „Intern“ gelistet und nie standardmässig an die Mail an den Treuhänder angehängt. Wird ein Auszug erstellt, solange nicht erledigte offene Punkte bestehen, fragt die App zuerst („Es gibt noch N offene Punkte. Trotzdem erstellen?“, mit Weg zu den Prüfungen).
- **F10.3** Bezeichnungen und Formularverweise passend zum gewählten Land und Kanton.
- **F10.4** Kopfzeile mit Name, Steuerjahr, Kanton, Erstellungsdatum und Hinweis „keine Steuerberatung“.
- **F10.5** Alle Exporte werden im Projekt mit Datum gespeichert und bleiben abrufbar.
- **F10.6** Mail-Entwurf an den Treuhänder (Name hinterlegbar) mit den zwei Werten, Anhängen-Liste (nur Auszüge, nicht der interne Prüfbericht) und offenen Fachfragen (die gehören dem Treuhänder, nicht der Steuerbehörde); Text zum Kopieren.
- **F10.6a** Mail direkt aus der App senden: Im Projekt (Exporte) „An Treuhänder senden“ öffnet
  einen Dialog mit Empfänger (aus dem Profil, änderbar), CC an mich, Betreff und Text aus der
  Vorlage (F11.10, im Dialog noch bearbeitbar), auswählbaren Anhängen (erstellte Auszüge PDF/Excel)
  und Vorschau; der interne Prüfbericht (F10.2a) ist nie vorausgewählt. Senden erst nach ausdrücklicher Bestätigung. Jede gesendete Mail wird im Projekt
  protokolliert (Datum, Empfänger, Betreff, Anhänge, Status/Fehler), ohne Passwörter. Ohne
  eingerichteten Mailer bleibt es beim Text zum Kopieren und einem `mailto:`-Link (ohne Anhänge).

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

Alles Projektübergreifende lebt an drei Orten: **Mappings** im Hauptmenü, **Profil** und
**Einstellungen** im Benutzermenü oben rechts.

- **F11.0s Einrichtung beim ersten Aufruf**: Beim allerersten Start (Desktop) bzw. nach der
  ersten Anmeldung (Web) führt ein Assistent als **Stepper** durch alles, was die App zum
  Arbeiten braucht: Schrittleiste mit Nummer, Titel und Zustand je Schritt (offen / erledigt /
  übersprungen / Fehler), „Zurück“/„Weiter“ fix unten (Dialog-Regel), „Später“ für optionale
  Schritte, Zwischenstand wird gespeichert (Abbruch und Fortsetzen möglich). Jeder Schritt mit
  kurzer Erklärung, wozu er dient, Link „Wo bekomme ich den Schlüssel?“ und – wo möglich –
  einem **Test-Knopf**, der die Eingabe sofort prüft. Schlüssel werden verschlüsselt gespeichert
  und nie wieder angezeigt (F11.0b). Jederzeit über Einstellungen wieder aufrufbar; danach
  ist alles in Profil/Einstellungen einzeln änderbar.
  1. **Profil** – Name, Wohnkanton, Sprache, Zahlen-/Datumsformat (F11.1, F11.2). Pflicht.
  2. **Treuhänder** – Name und E-Mail (F11.1). Optional.
  3. **AI-Plugin** – Anbieter, Modell, Schlüssel, Verbindung testen, Zustimmung (F5.13, F5.14).
     Optional („ohne AI fortfahren“ – dann Mappings nur manuell).
  4. **Kurse** – Internet-Kurse ein/aus (F11.3), CoinGecko-Schlüssel (testen), ESTV-Kursliste
     automatisch beziehen (F7.4a). Optional, mit Hinweis auf fehlende Kurse ohne Schlüssel.
  5. **Wallets & Netzwerke** – Etherscan-Schlüssel (alle EVM-Chains), Solana-Indexer (z. B.
     Helius), weitere Netzwerk-Schlüssel nach Bedarf (F6.3, F6.7), je mit Test; optional,
     erste Wallet-Adressen direkt erfassen.
  6. **Mail** – Mailer (SMTP) mit Test-Mail und Vorlage übernehmen/anpassen (F11.10). Optional.
  7. **Speicherort** (nur Desktop) – Datenordner wählen, auch Sync-Ordner (F3.1).
  8. **PIN** – 4–8 Ziffern, zweimal eingeben (F11.0p). Desktop: Pflicht; Web: optional.
  9. **Zusammenfassung** – was eingerichtet ist und was fehlt (mit Auswirkung, z. B. „ohne
     CoinGecko-Schlüssel haben FLR/SGB keinen Kurs“), Knopf „App starten“ bzw. „Erstes
     Projekt anlegen“.

  Erst nach Abschluss (oder Überspringen der optionalen Schritte) öffnet sich die App. Fehlt
  später etwas, das eine Funktion braucht, verweist die App direkt auf den passenden Schritt.

- **F11.0p PIN-Sperre**: Der PIN wird bei **jedem Öffnen** der App verlangt – Desktop: bei jedem
  Start und nach dem Entsperren aus dem Ruhezustand/automatischer Sperre nach einstellbarer
  Inaktivität; Web (falls gesetzt): beim Öffnen eines neuen Tabs/Fensters nach dem Schliessen
  und nach Inaktivität, zusätzlich zum Login. Gespeichert wird nur ein langsamer Hash (z. B.
  scrypt/Argon2 mit Salz), nie der PIN. Nach mehreren Fehlversuchen wachsende Wartezeit.
  Solange gesperrt, beantwortet auch die lokale API keine Datenanfragen. PIN ändern im Profil
  (alter PIN nötig); PIN vergessen: Desktop – Zurücksetzen nur mit Bestätigung, dass
  verschlüsselte Schlüssel (AI, Mailer, Kurse) neu eingegeben werden müssen; Web – über den
  Login (E-Mail) neu setzen. Präzisiert (07.10.2026): automatische Sperre nach 1–240 Minuten
  ohne Aktivität (Vorgabe 15), auf dem Desktop auch beim Sperren des Bildschirms und im
  Ruhezustand; Wartezeit nach Fehlversuchen 0, 1, 2, 5, 10, 30 s … bis 15 min; im Web nach
  10 Fehlversuchen neue Anmeldung nötig; ein zweiter Tab, solange die App offen und entsperrt
  ist, fragt nicht erneut.
- **F11.0 Mappings** (eigene Seite im Hauptmenü, neben Dashboard und Projekte): alle Mappings
  des Benutzers – sie gelten für alle seine Projekte; ein in einem Projekt erstelltes Mapping
  steht in allen anderen zur Verfügung. Auflisten (Name, Plattform, Herkunft AI/manuell,
  zuletzt geändert), suchen, ansehen (JSON), bearbeiten mit Vorschau, löschen (mit Bestätigung
  und Hinweis auf betroffene Dateien), herunter- und hochladen. Je Mapping sichtbar, **welche
  Projekte und Dateien es nutzen** (mit Link dorthin). Kein Benutzer sieht die Mappings eines
  anderen – ausser was jemand selbst in der Mapping-Bibliothek veröffentlicht (F5.15, nur Web);
  eine dort übernommene Kopie ist ein eigenes Mapping (Herkunft „aus Bibliothek“).
- **F11.0a Profil** – die Person und das Konto: persönliche Angaben (F11.1), Sprache (F11.2),
  Zahlen- und Datumsformat; in der Web-App zusätzlich E-Mail/Passwort ändern, Abmelden, alle
  Daten herunterladen (F10.9 / F2.3) und Konto löschen (F2.2). Desktop: ohne Konto-Teil.
- **F11.0b Einstellungen** – app-weite Konfiguration, in Abschnitte gegliedert: **AI** (Anbieter, Modell,
  Schlüssel, Zustimmung, F5.13/F5.14), **Kurse** (Internet-Kurse ein/aus F11.3, CoinGecko-Schlüssel,
  ESTV-Kursliste), **Wallets/Netzwerke** (API-Schlüssel wie Etherscan, F6.7), **Speicherort**
  (Desktop, F3.1), **Cloud-Verbindungen** (Web, F3.2) und **Mail** (F11.10). Schlüssel und
  Passwörter werden nie wieder angezeigt (nur die letzten Zeichen).
- **F11.10 Mail** (Einstellungen): **Mailer** hinterlegen – SMTP (Server, Port, Verschlüsselung
  TLS/STARTTLS, Benutzer, Passwort verschlüsselt gespeichert, Absendername und -adresse) mit
  „Test-Mail an mich senden“. **Text-Vorlage** für die Treuhänder-Mail definieren: Betreff und
  Text mit Platzhaltern (z. B. `{{name}}`, `{{treuhaender}}`, `{{steuerjahr}}`, `{{kanton}}`,
  `{{vermoegen}}`, `{{ertrag}}`, `{{anhaenge}}`, `{{offene_punkte}}`, `{{datum}}`), Liste der
  Platzhalter mit Erklärung, Live-Vorschau mit Beispielwerten, „auf Standard zurücksetzen“.
  Eine Standardvorlage je Sprache (F11.2) ist vorhanden; die eigene Vorlage gilt für alle
  Projekte.
- Im Projekt bleiben nur projektbezogene Dinge (Dateien, die im Projekt genutzten Mappings mit
  Link auf die Mappings-Seite, Kurse/Overrides des Projekts, Ergebnis, Prüfungen, Korrekturen,
  Exporte).

- **F11.1** Persönliche Angaben für die Exporte (Name, Wohnkanton, Treuhänder).
- **F11.2** Sprache, Zahlen- und Datumsformat. Die App ist vollständig übersetzbar; zunächst
  **Deutsch (Schweiz)** und **Englisch**. Die Sprache wird im Benutzerprofil eingestellt und
  gespeichert (Web: am Benutzer; Desktop: lokal) und gilt sofort, ohne Neuladen. Vorgabe beim
  ersten Login: Browsersprache, sonst Deutsch. Exporte erscheinen in der eingestellten Sprache;
  steuerliche Fachbegriffe und Formularverweise kommen aus den Landesregeln (F10.3). Weitere
  Sprachen = eine neue Übersetzungsdatei. Präzisiert (07.10.2026): Zahlenformat 1’234.56
  (de-CH) oder 1,234.56 (en), Datumsformat TT.MM.JJJJ, JJJJ-MM-TT, TT/MM/JJJJ oder MM/TT/JJJJ;
  eine neue Sprache bringt ihre Formate mit (Englisch: 1,234.56 und JJJJ-MM-TT), solange keine
  eigenen gewählt sind. Im Englischen behalten Schweizer Fachbegriffe ohne Entsprechung den
  amtlichen deutschen Begriff in Klammern (z. B. „securities list (Wertschriftenverzeichnis)“).
  Der Datenexport im Standardformat (F10.7) behält seine deutschen Spaltennamen (Dateiformat,
  wieder importierbar); nur die Info-Spalten folgen der Sprache.
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

## 11b. Benachrichtigungen

- **F11.11** Benachrichtigungs-Zentrale: Glocke in der Kopfzeile mit Zähler der ungelesenen
  Meldungen; Klick öffnet eine Liste (neueste zuerst, gruppiert nach Projekt) mit Typ
  (Fehler / Handlungsbedarf / Info / Erfolg), Zeit, kurzer Beschreibung und **direkter Aktion**
  („Zum Hinweis“, „Erneut versuchen“, „Schlüssel prüfen“, „Auszug öffnen“). Einzeln oder alle als
  gelesen markieren, erledigte ausblenden; Meldungen bleiben gespeichert (pro Benutzer, auch nach
  Neustart) und verschwinden automatisch, wenn die Ursache behoben ist.
- **F11.12** Was eine Meldung auslöst, mindestens:
  - **Fehlgeschlagen**: Kursabruf (welche Assets), ESTV-Kursliste, AI-Aufruf (mit Fehlerdetails),
    Mail-Versand, Export/Auszug, Paket-Import, Wallet-Abruf, Upload/Lesen einer Datei.
  - **Handlungsbedarf**: Datei ohne Mapping, Zeilenfehler, neue offene Punkte/Hinweise nach einer
    Neuberechnung, Positionen ohne Kurs, Daten seit dem Versand an den Treuhänder geändert (F4.7),
    Einrichtung unvollständig (F11.0s), Schlüssel ungültig/abgelaufen, Sync-Konflikt (F3.4).
  - **Info/Erfolg**: neue Fassung der ESTV-Kursliste verfügbar, lange Aufgabe fertig (aus der
    Aktivitätsanzeige), Mail gesendet.
- **F11.13** Fertige oder fehlgeschlagene Hintergrundaufgaben aus der Aktivitätsanzeige landen
  automatisch als Meldung in der Zentrale. Desktop: optional zusätzlich als System-Benachrichtigung
  (ein-/ausschaltbar in den Einstellungen); Web: nur in der App. Keine Meldung enthält Schlüssel,
  Passwörter oder Buchungsdetails.
  Präzisiert (08.10.2026): Je Ursache gibt es **eine** Meldung (stabiler Schlüssel, z. B. „Kurse
  für Projekt X“); tritt sie erneut auf, wird diese aktualisiert statt verdoppelt. Ein Zustand
  (offene Punkte, Positionen ohne Kurs) wird nur bei einer Änderung wieder als ungelesen
  gemeldet; „Ausblenden“ gilt, bis sich die Ursache ändert. Erledigte Meldungen werden nach
  30 Tagen gelöscht. Aus der Aktivitätsanzeige landen Fehler immer, erfolgreiche Aufgaben nur,
  wenn man die Seite inzwischen verlassen hat (sonst genügt die Erfolgsmeldung). System-
  Benachrichtigungen (Desktop) nur für Fehler und Handlungsbedarf, standardmässig ein
  (Einstellungen › System). „Einrichtung unvollständig“ (F11.0s) meldet, sobald der Assistent
  gebaut ist.

## 11c. AI-Assistent und MCP

- **F11.14 AI-Chat (Seitenleiste)**: Eine ein-/ausklappbare Seitenleiste mit einem Chat, der beim
  Bedienen hilft. Er nutzt das konfigurierte AI-Plugin (F5.13) – ohne Plugin ist er deaktiviert
  mit Hinweis auf die Einrichtung. Er kennt den Kontext (aktuelle Seite, Projekt, Prüfungen,
  Hinweise) und kann:
  - erklären („Warum fehlt der Kurs für FLR?“, „Woher kommt diese Zahl?“ – mit Links bis zur
    Buchung, F7.5),
  - **nach Dateien fragen** und den Upload direkt im Chat anbieten („Lade den Kraken-Kontoauszug
    Dezember hoch“), Mappings erstellen lassen (F5.13),
  - **Einträge korrigieren**: Korrekturen vorschlagen und nach Bestätigung anlegen (Kurs
    überschreiben, umklassieren, manuelle Position – F9.x, mit Begründung), Hinweise als erledigt
    markieren, Neuberechnung, Kurse aktualisieren, Auszug erstellen,
  - navigieren (öffnet die passende Seite/den passenden Tab).

  **Jede ändernde Aktion wird vorher als Vorschlag gezeigt und erst nach ausdrücklicher
  Bestätigung ausgeführt**; alles landet im Korrekturverlauf bzw. Protokoll. Abgeschlossene
  Projekte bleiben schreibgeschützt. Gesendet werden nur die für die Frage nötigen Daten; die
  Zustimmung F5.14 gilt sinngemäss (für den Chat einmalig als Hinweis bestätigt, in
  Einstellungen › AI widerrufbar). Verlauf pro Benutzer (löschbar).

- **F11.15 Prompt bearbeiten**: In Einstellungen › AI lässt sich der **Standard-Prompt** des
  Assistenten (System-Prompt: Rolle, Ton, Sprache, Grenzen) ansehen, bearbeiten und auf den
  Standard zurücksetzen; die eingebauten Sicherheitsregeln (Bestätigung vor Änderungen, keine
  Steuerberatung, keine Schlüssel) bleiben immer aktiv.
- **F11.16 MCP-Server**: lazy-koins stellt seine Funktionen als **MCP-Server** (Model Context
  Protocol) bereit, damit externe AI-Clients (z. B. Claude Desktop, Claude Code) damit arbeiten
  können – **für alles**, was die App kann: Projekte, Dateien (hochladen, lesen, zuordnen),
  Mappings, Kurse, Berechnung, Ergebnis mit Rückverfolgung, Prüfungen/Hinweise, Korrekturen,
  Exporte, Wallets, Einstellungen (ohne Schlüssel). Chat (F11.14) und MCP nutzen **dieselbe
  Werkzeug-Schicht**. In Einstellungen › MCP **aktivierbar** (standardmässig aus), mit Auswahl,
  welche Werkzeugbereiche freigegeben sind und ob schreibende Werkzeuge erlaubt sind;
  Anleitung/Konfigurationsschnipsel für gängige Clients. Web: Zugriff über persönliche
  Zugriffstoken (erstellen, benennen, Ablauf, widerrufen); Desktop: lokaler Server
  (stdio oder 127.0.0.1) ohne Netzwerkzugriff von aussen. Jeder MCP-Aufruf wird protokolliert.
  Umsetzung: Streamable HTTP unter `/api/mcp` (Web und Desktop, Zugriffstoken auch auf dem
  Desktop); der Desktop liefert zusätzlich einen stdio-Einstieg (`mcp-stdio.js`) mit, weil sich
  sein lokaler Port bei jedem Start ändert.
  **Jede MCP- und Chat-Werkzeug-Aktion ist strikt auf den angemeldeten Benutzer beschränkt**
  (Benutzer nur aus dem Token/der Anmeldung, nie aus Argumenten; fremde Daten = 404).

## 11b. Bedienung

- **F11.20 Aktivitätsanzeige**: Alles, was im Hintergrund läuft und länger als etwa eine Sekunde
  dauern kann (Kurse aktualisieren, ESTV-Kursliste, AI-Mapping und AI-Auszug, Uploads,
  Neuberechnung, Auszüge PDF/Excel, Mapping erneut anwenden), erscheint unten rechts in einer
  kleinen Leiste mit Spinner und Bezeichnung („Kurse werden aktualisiert (12/40) …“), wenn
  möglich mit Fortschritt; laufen mehrere, „3 Aufgaben laufen“ mit aufklappbarer Liste. Sie
  blockiert nichts, bleibt beim Wechsel der Seite sichtbar, liegt über Dialogen und Meldungen,
  und wird am Ende zur Erfolgs- oder Fehlermeldung (wo sinnvoll mit Link, z. B. „Herunterladen“
  oder „Anzeigen“). Barrierefrei (Statusmeldung für Screenreader, Spinner ohne Bewegung bei
  „Bewegung reduzieren“), hell und dunkel. Die Benachrichtigungs-Zentrale (F11.13) übernimmt
  die fertigen Aufgaben später von hier.
- **U1 Tabellen**: Alle Tabellen passen ab 1024 px Breite ohne seitliches Scrollen. Zu lange
  Texte werden mit „…“ abgeschnitten, der volle Text erscheint als Tooltip. Die Aktionen einer
  Zeile stehen fix am rechten Rand: eine einzelne Aktion als Symbol-Knopf, mehrere hinter einem
  Knopf mit drei senkrechten Punkten, der ein Menü öffnet (z. B. Dateien: Vorschau,
  Herunterladen, Mit AI auslesen/erstellen, Zuordnen, Entfernen).
- **U2 Seitenweise Anzeige**: Jede Tabelle, die gross werden kann, zeigt 10 Zeilen pro Seite
  (wählbar 10 / 25 / 50 / 100, pro Tabelle gemerkt), mit „Zeile 1–10 von 57“ und Blättern.
- **U3 Genaue AI-Fehler**: Schlägt eine AI-Anfrage oder der Verbindungstest fehl, zeigt die App
  neben der Zusammenfassung die Details (HTTP-Status und Meldung des Anbieters, Adresse, Modell,
  Fehlercode, Ursache) mit einem Hinweis, was zu prüfen ist, und „Details kopieren“. Der
  API-Schlüssel erscheint nie in einer Meldung oder einem Log.

## 12. Abnahme

- **A1** Mit den echten Daten (lokal in `private/`, Sollwerte in `private/golden.json`) ergibt das Projekt 2025 dieselben Werte wie die manuelle Auswertung (±0.05 CHF); der Kraken-Saldo per 31.12.2025 stimmt exakt mit dem Kontoauszug überein.
- **A2** Ein Benutzer kann ohne technische Kenntnisse ein Projekt anlegen, Dateien hochladen, die Prüfungen einsehen, Korrekturen erfassen und beide Auszüge exportieren – in der Web-App und in der lokalen App.

## Nicht im Umfang (vorerst)

Kapitalgewinnberechnung und andere Länder als CH · direkte Börsen-APIs · E-Steuerauszug eCH-0196 · Mobile App.
