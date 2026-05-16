# Finanzamt-Prüfmethodik — Referenzdokument für AI Tax Advisor

## Zweck dieses Dokuments

Dieses Dokument beschreibt, welche Methoden das deutsche Finanzamt und die ELSTER-Software verwenden, um Steuererklärungen zu prüfen. Der AI Tax Advisor soll dieselben Prüflogiken anwenden, sodass der Mandant potenzielle Beanstandungen erkennt, bevor er sie einreicht.

> **Wichtig:** Der AI Tax Advisor ist kein Steuerberater. Alle Hinweise sind informationeller Art.

---

## 1. ELSTER Risikomanagementsystem (RMS)

### 1.1 Funktionsweise

Das Finanzamt verwendet seit 2005 ein automatisiertes **Risikomanagementsystem (RMS)**, das allen eingehenden Steuererklärungen einen Risikoscore zuweist. Erklärungen mit niedrigem Score werden automatisch (ohne manuelle Prüfung) veranlagt — die sogenannte **Richtigkeitsfiktion**. Erklärungen mit hohem Score werden für manuelle Prüfung oder Betriebsprüfung markiert.

Die genauen Algorithmen sind nicht öffentlich. Bekannte Faktoren:

- **Konsistenz**: Stimmen UStVA-Daten mit EÜR überein?
- **Plausibilität**: Liegen Betriebsausgaben im Branchendurchschnitt?
- **Zeitreihe**: Starke Abweichungen zum Vorjahr?
- **Vollständigkeit**: Fehlen erwartete Anlagen (z.B. AVEÜR bei Anlagevermögen)?

### 1.2 Automatische Plausibilitätsprüfungen in ELSTER

ELSTER prüft beim Einreichen automatisch:

| Prüfung | Beschreibung |
|---|---|
| Umsatz ≠ UStVA-Summe | Summe der UStVA-Monate muss mit Jahres-UStE übereinstimmen |
| USt auf Privatanteil | Bei Firmenwagen: monatliche fiktive Einnahmen müssen gemeldet sein |
| ZM ohne EU-Umsätze | ZM nur wenn tatsächlich EU-B2B-Umsätze vorhanden |
| Fehlende Anlage AVEÜR | Wenn Anlagevermögen in EÜR → AVEÜR Pflicht |
| Negative Vorsteuern | Vorsteuer > Umsatzsteuer → Prüfung auf Erstattung |
| Rundungsdifferenzen | Gerundete Summen = Schätzungsverdacht |

---

## 2. Branchenbezogene Richtsätze (BMF-Richtsatzsammlung)

Das Bundesministerium der Finanzen veröffentlicht jährlich die **Richtsatzsammlung**, die typische Gewinnspannen und Aufwandsquoten nach Branchen zeigt. Wird vom Finanzamt für den Außenprüfungsvergleich genutzt.

### 2.1 Typische Werte (Auswahl, Stand 2025)

| Branche | Rohgewinn-Richtsatz | Reingewinn-Richtsatz |
|---|---|---|
| Friseur | 50–65% | 15–25% |
| IT-Dienstleistungen | 60–80% | 25–45% |
| Online-Handel (Elektronik) | 20–35% | 5–12% |
| Fotografie (gewerblich) | 55–70% | 20–35% |
| Unternehmensberatung | 70–90% | 30–55% |
| Übersetzungsdienstleistungen | 65–80% | 30–50% |

**Konsequenz für AI Tax Advisor:** Wenn die Betriebsausgaben eines Mandanten dazu führen, dass sein Reingewinnanteil deutlich unter dem Richtsatz liegt → `WARNING: Außergewöhnlich hohe Ausgaben — Prüfrisiko.`

### 2.2 Verdächtige Ausgabenquoten

Finanzamt beachtet besonders:
- **Bewirtungskosten** > 2–3% des Umsatzes → Prüfantrieb
- **Kfz-Kosten** ohne nachvollziehbaren betrieblichen Zweck
- **Reisekosten** ohne Fahrtenbuch oder Belege
- **Telekommunikation** ohne private Nutzungsaufteilung

---

## 3. Kontrollmitteilungen und Querverbindungen

Das Finanzamt erhält automatisch Daten von Dritten:

| Quelle | Übermittelte Daten |
|---|---|
| Banken | Kapitalerträge, Zinsen (Kapitalertragsteuer) |
| Arbeitgeber | Arbeitslohn (Lohnsteuerbescheinigung) |
| Rentenversicherung | Rentenzahlungen |
| Krankenversicherung | Beitragsdaten (Sonderausgabenabzug) |
| ELSTER-System | Quervergleich zwischen UStVA und EÜR |
| Auslandsbanken (CRS) | Konten in 100+ Ländern (Common Reporting Standard) |

**Konsequenz:** Nicht gemeldete Einnahmen (Freelance-Zahlungen via PayPal, Plattform-Auszahlungen) können durch Kontrollmitteilungen aufgedeckt werden.

---

## 4. Typische Prüfungsschwerpunkte bei Einzelunternehmern

### 4.1 Firmenwagen (§6 Abs. 1 Nr. 4 EStG)

- 1%-Regel korrekt angewendet? → Bruttolistenpreis × 1% monatlich als Einnahme
- MSRP (Bruttolistenpreis) korrekt ermittelt? → Bei Gebrauchtwagen: Original-MSRP bei Erstzulassung
- Fahrtenbuch statt 1%-Regel? → Vollständigkeit und Lückenlosigkeit prüfen
- Privatanteil auch in UStVA gemeldet? → Umsatzsteuer auf Privatanteil

**AI-Check:** Monatliche "Fictional Income"-Einträge vorhanden? MSRP × Rate korrekt berechnet?

### 4.2 Bewirtungskosten (§4 Abs. 5 Nr. 2 EStG)

Pflichtangaben im Bewirtungsbeleg:
- Datum und Ort (Restaurantname + Adresse)
- Teilnehmer (Namen aller Personen)
- Anlass (konkreter Geschäftszweck, nicht "Kundenpflege")
- Betrag inkl. Trinkgeld
- Unterschrift des Bewirtenden

Nur **70%** des Nettobewirtungsaufwands sind abzugsfähig.

**AI-Check:** Bewirtungskosten ohne entsprechenden strukturierten Beleg = `ERROR: Bewirtungsbeleg unvollständig — §4 Abs. 5 EStG`.

### 4.3 Häusliches Arbeitszimmer (§4 Abs. 5 Nr. 6b EStG)

Zwei Varianten:
1. **Homeoffice-Pauschale**: €6/Tag, max. €1.260/Jahr — kein Nachweis nötig
2. **Tatsächliche Kosten**: Nur wenn Arbeitszimmer Mittelpunkt der Tätigkeit → volle Kosten anteilig nach Fläche

**Konflikt-Check:** Homeoffice-Pauschale + Büromiete gleichzeitig = `WARNING` (nur möglich bei separatem Heimarbeitszimmer zusätzlich zum Büro).

### 4.4 Umsatzsteuer-Voranmeldung

**Häufige Fehler die Finanzamt findet:**
- Differenz zwischen UStVA-Summe und UStE-Jahresbetrag
- Nicht gemeldete EU-Erwerbe (§13b UStG)
- Fehlerhafte Zuordnung 7%/19%/0%
- Vorsteuer aus Rechnungen ohne Pflichtangaben (§14 UStG)
- Kleinunternehmer meldet Vorsteuer (verboten)

### 4.5 Abschreibungen (AfA)

**Geprüft wird:**
- Nutzungsdauer entspricht AfA-Tabellen?
- GWG-Sofortabschreibung korrekt angewendet (≤€800 netto)?
- Anlagevermögen in AVEÜR vollständig?
- Privatnutzungsanteil bei gemischten Wirtschaftsgütern?

---

## 5. Warnsignale die einen Prüfungsantrieb erzeugen

Die folgende Liste basiert auf veröffentlichten BMF-Schreiben, Fachliteratur (NWB, Haufe) und Steuerberater-Praxis:

### 5.1 Strukturelle Warnsignale

| Signal | Erklärung |
|---|---|
| Umsatz sinkt, Ausgaben steigen | Typisches Muster bei Steuervermeidung |
| Sehr hohe Betriebsausgaben-Quote | Abweichung von Richtsätzen |
| Viele runde Beträge | Deutet auf Schätzung statt Erfassung hin |
| Ausgaben kurz vor Jahresende | IAB-Nutzung oder Steueroptimierung |
| Wechsel der AfA-Methode | Ohne sachlichen Grund verdächtig |
| Plötzlich hohe Privatentnahmen | Prüfung auf verdeckte Gewinnausschüttung |

### 5.2 Branchenspezifische Warnsignale

**E-Commerce / Amazon FBA:**
- Fehlende OSS-Registrierung bei EU-B2C-Umsätzen > €10.000
- Amazon-Auszahlungen nicht vollständig als Einnahmen erfasst
- Lagerbestand nicht in Bilanz/AVEÜR abgebildet

**IT-Freelancer:**
- Reverse Charge nicht korrekt angewendet bei EU-B2B
- US-Clienten ohne §3a UStG-Prüfung
- Scheinselbstständigkeit bei einem Hauptkunde > 80% Umsatz

**Handwerk / Friseur:**
- Bareinnahmen ohne Kassenbuch
- Trinkgeldbetrag nicht in Einnahmen

**Fotograf / Kreative:**
- Falsche Zuordnung 7%/19% (7% nur für Urheberwerklizenzen, nicht Dienstleistungen)
- KSK-Pflicht nicht erkannt

---

## 6. §14 UStG — Pflichtangaben auf Eingangsrechnungen

Nur Rechnungen mit allen Pflichtangaben berechtigen zum Vorsteuerabzug:

1. Vollständiger Name und Anschrift des Lieferanten
2. Vollständiger Name und Anschrift des Leistungsempfängers
3. Steuernummer oder USt-IdNr. des Lieferanten
4. Ausstellungsdatum der Rechnung
5. Fortlaufende Rechnungsnummer
6. Menge und Art der Leistung / Lieferung
7. Zeitpunkt der Lieferung / Leistungserbringung
8. Nettobetrag, Steuersatz, Steuerbetrag separat ausgewiesen
9. Bei steuerfreien Leistungen: Hinweis auf Befreiungsgrund

**Kleinbetragsrechnung** (≤ €250 brutto): vereinfachte Anforderungen (§33 UStDV).

---

## 7. Aktuelle Prüfungsschwerpunkte 2025–2026

Basierend auf veröffentlichten Prüfungsberichten der Finanzverwaltungen:

1. **Plattformwirtschaft**: Einkünfte von Etsy, Amazon, Airbnb, Uber nach EU-DAC7-Richtlinie (Plattformen melden automatisch an Finanzamt)
2. **Krypto-Assets**: Veräußerungsgewinne nach §23 EStG (Haltefrist < 1 Jahr)
3. **OSS-VAT**: Korrekte Abführung bei EU-B2C-Umsätzen
4. **Homeoffice**: Korrekte Anwendung der Pauschale vs. tatsächliche Kosten
5. **Elektrofahrzeuge**: Korrekte 0,25%-Regel vs. 1%-Regel bei BEV/PHEV
6. **Reverse Charge**: Korrekte Anwendung bei digitalen Dienstleistungen aus dem EU-Ausland

---

## 8. Quellen

- Richtsatzsammlung 2024 (BMF, Schreiben vom 17.12.2024)
- §14 UStG, §19 UStG, §4 EStG, §6 EStG (gesetze-im-internet.de)
- ELSTER Entwicklerdokumentation (elster.de/eportal/entwickler)
- NWB Steuerhandbuch 2025
- Haufe: Betriebsprüfung — Prüfungsschwerpunkte
- BStBK Hinweise zu Mandatspflichten 2024
- DAC7-Umsetzung in deutsches Recht (Plattformen-Steuertransparenzgesetz 2023)
