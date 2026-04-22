# Juridische analyse: clean-room read + write van DWG/DXF/DGN in de EU

> **Status**: onderzoeksrapport, geen formeel juridisch advies.
> **Datum**: 2026-04-21
> **Context**: Open 2D Studio — CAD-applicatie met DWG/DXF/DGN interoperabiliteit vanuit een EU-gevestigde ontwikkelaar.

---

## Kernconclusie

**Schrijven is in beginsel net zo rechtmatig als lezen**, onder dezelfde EU-juridische basis. Er is géén principieel juridisch onderscheid tussen parsers en writers: artikel 6 Softwarerichtlijn 2009/24/EG spreekt van *interoperabiliteit*, en overweging 10 definieert dat als "*the ability to exchange information and **mutually** to use the information*" — bidirectioneel dus. Het risico verschilt echter sterk per formaat.

| Formaat | Risicoprofiel EU | Clean-room strikt nodig? |
|---|---|---|
| **DXF** | **Zeer laag** | Nee (Autodesk publiceert de spec sinds 1982) |
| **DGN** | **Laag** | Aanbevolen voor V8; V7 praktisch overbodig |
| **DWG** | **Gemiddeld** | **Ja**, met strikte procedure |

---

## 1. Juridisch fundament (geldt voor alle drie formaten)

### Softwarerichtlijn 2009/24/EG

- **Art. 5(3)** — observe/study/test van een programma is toegestaan zonder toestemming van de rechthebbende, tijdens normaal gebruik.
- **Art. 6** — decompilatie voor interoperabiliteit is toegestaan, mits:
  - (a) uitgevoerd door een rechtmatige gebruiker,
  - (b) de informatie niet eerder "readily available" was,
  - (c) beperkt tot de delen die noodzakelijk zijn voor interoperabiliteit.
- **Art. 8 — dwingend recht**: contractuele afwijkingen van art. 5(2), 5(3) en 6 zijn **nietig**. Een EULA-clausule die reverse engineering voor interoperabiliteit verbiedt, is naar EU-recht niet afdwingbaar.
- **Nederlandse implementatie**: art. 45m Aw (decompilatie-exceptie), art. 45n Aw (nietigheid van afwijkende bedingen).

### Relevante CJEU-jurisprudentie

- **HvJ EU C-406/10 *SAS Institute v World Programming Ltd*** (2 mei 2012) — dé beslissende uitspraak:
  > *"Neither the functionality of a computer program, nor the programming language and the format of data files used in a computer program in order to exploit certain of its functions, constitute a form of expression of that program, and, as such, are not protected by copyright in computer programs."*

  Bestandsformaten zijn dus niet auteursrechtelijk beschermd als onderdeel van het programma.
- **HvJ EU C-393/09 *Bezpečnostní softwarová asociace (BSA)*** (22 december 2010) — GUI geen uitdrukkingsvorm onder Softwarerichtlijn; bevestigt enge interpretatie.
- **HvJ EU C-13/20 *Top System SA v Belgische Staat*** (6 oktober 2021) — decompilatie voor bugfix toegestaan; ondersteunt pragmatische interpretatie van excepties.
- **HvJ EU C-5/08 *Infopaq*** (16 juli 2009) — originaliteitsmaatstaf voor auteursrechtelijke bescherming; de *implementatie* (broncode) is beschermd, de spec niet.

### Trade Secrets Richtlijn (EU) 2016/943

- **Art. 3(1)(b)** erkent expliciet reverse engineering als "lawful means" om bedrijfsgeheimen te verkrijgen:
  > *"observation, study, disassembly or testing of a product or object that has been made available to the public or that is lawfully in the possession of the acquirer"*

Bij software prevaleert de Softwarerichtlijn als *lex specialis*: click-through EULA's kunnen decompilatie voor interoperabiliteit niet uitsluiten, ook niet via de trade-secret-route.

### Leesbaar = schrijfbaar

Overweging 10 van de Softwarerichtlijn spreekt van "*mutually* to use the information" — bidirectioneel. Een parser zonder writer is slechts halve interoperabiliteit en frustreert de pro-competitieve doelstelling van overweging 15. In 40+ jaar DXF, 25+ jaar ODA DWG-writing en 20+ jaar GDAL DGN-writing is er in Europa **geen enkele succesvolle rechtszaak** tegen een write-implementatie op auteursrechtelijke grond.

---

## 2. DXF (Autodesk) — laagste risico

**Feitelijke situatie:**
- Autodesk publiceert de DXF Reference zelf publiek sinds 1982 — het formaat is *bij ontwerp* een uitwisselingsformaat.
- Geen EULA of click-through op de publieke PDF's die implementatie verbiedt. Copyright ziet alleen op de *tekst* van de spec, niet op de *regels* of *bytes-layout*.
- Autodesk's eigen officiële positie: *"Autodesk has never precluded, and does not seek to preclude others from either using .dwg as a file extension or from making software that is compatible with the Autodesk DWG file format."* (A fortiori voor DXF.)
- AutoCAD LT, Blender, Inkscape, LibreCAD, QCAD, FreeCAD, BricsCAD, Rhino, Vectorworks, ArchiCAD — allemaal DXF I/O zonder Autodesk-licentie.

**Juridische implicatie:**
- Art. 6 Softwarerichtlijn (decompilatie-exceptie) is praktisch **niet eens nodig**: de informatie is "readily available" via de publieke spec.
- Art. 5(3) dekt aanvullende file-observatie om spec-lacunes (ACIS solids, sommige object types) in te vullen.

**Trademark:** "DXF" is een Autodesk-merk; gebruik nominative fair use ("supports DXF format"), nooit als productnaam ("DXF Studio").

**Conclusie**: clean-room procedure niet strikt nodig, maar governance-hygiëne. Bestaande Rust-crates (`dxf`, `dxf-rs`) onder MIT/Apache zijn juridisch veilig.

---

## 3. DGN (Bentley) — laag risico

**Feitelijke situatie:**
- Bentley voert actief een "openness"-beleid sinds V8 (2000).
- V7 (Intergraph IGDS-afstamming) heeft publieke documentatie uit het pre-internet-tijdperk.
- V8 gebruikt OLE Structured Storage (CFBF) — publiek gedocumenteerd door Microsoft.
- ODA levert al 20 jaar commercieel read+write van V7 én V8 — **zonder juridische actie van Bentley**.
- GDAL/OGR bevat een V7 read+write driver onder MIT-licentie; decennia ongemoeid gebleven, veel gebruikt in EU publieke sector.
- Autodesk is in 2020 ODA-lid geworden — de relatie is coöperatief.
- Bentley's strategie is applicatie-gericht (MicroStation, iTwin), niet formaat-lock-in; actief lid van buildingSMART / OpenBIM.

**Juridische implicatie:**
- Zelfde Softwarerichtlijn-basis als DWG, maar voorwaarde art. 6(1)(b) ("informatie niet readily available") is voor V7 deels al vervuld door publieke documentatie.
- Geen bekende litigatie-geschiedenis door Bentley tegen reverse engineers.

**Trademark:**
- "MicroStation" en "Bentley" zijn geregistreerde merken — vermijden als branding.
- "DGN" als woordmerk is zwak (beschrijvend/generiek voor bestandsformaat). Nominative use ("supports DGN files") veilig.

**Aanbeveling:**
- V7 write eerst (laagste risico; GDAL als inspiratie qua interface, niet als code-copy tenzij licentie geaccepteerd).
- V8 write via eigen clean-room implementatie óf via commerciële ODA Drawings SDK licentie.

---

## 4. DWG (Autodesk) — gemiddeld risico, duidelijke spelregels

### Historische context: Autodesk v. ODA (2006–2010)

**Ronde 1 (november 2006 – april 2007)**: Autodesk klaagde ODA aan omdat DWGdirect een **TrustedDWG-watermark** schreef dat de tekst *"Autodesk DWG. This file is a Trusted DWG … last saved by an Autodesk application or Autodesk licensed application"* bevatte. Autodesk stelde merkinbreuk op het **AUTODESK-merk** (niet het DWG-merk, dat toen nog niet officieel bestond).

**Uitkomst ronde 1 (april 2007)**: geschikt, ODA verwijderde TrustedDWG-support.

**Settlement april 2010** (confidentieel maar publiekelijk toegelicht):
- ODA trekt haar DWG-merkregistraties in.
- Autodesk trekt cancellation-procedures bij het TTAB in.
- Autodesk bevestigt: ODA mag doorgaan met het ontwikkelen van DWG-compatibele software en mag de `.dwg`-extensie blijven gebruiken.

**2020**: Autodesk wordt zelf ODA-lid — de relatie is coöperatief.

**Kern**: de zaak ging over het **TrustedDWG-watermark** en over **trademarks**, niet over auteursrecht op het formaat zelf.

### Trademark-status "DWG"

- **USPTO** weigerde in juni 2011 definitief om "DWG" als woordmerk voor Autodesk te registreren (Section 2(e)(1): te beschrijvend). Bekrachtigd 2013.
- **EUIPO**: Autodesk bezit diverse EU-merkregistraties rond "DWG" (vaak gecombineerd met logo's). Het pure woordmerk is zwak. Verifieer actuele status via EUIPO eSearch plus.
- Autodesk's eigen statement (zie §2 hierboven) blijft ook voor DWG gelden.

### Drie harde grenzen voor DWG-write

1. **Geen TrustedDWG-watermark schrijven**
   - Sinds AutoCAD 2007 embedt Autodesk een string + encrypted checksum.
   - Dit namaken = trademark-inbreuk + oneerlijke handelspraktijk (Richtlijn 2005/29/EG).
   - **Doe**: schrijf een neutrale creator-string (bijv. "Open 2D Studio v1.x").
   - AutoCAD toont dan een "non-trusted"-waarschuwing — dat is volkomen legaal.

2. **"DWG" niet als productnaam/branding**
   - **Wel**: *"Open 2D Studio — supports DWG, DXF and IFC files"*.
   - **Niet**: *"DWG Studio"*, *"Open DWG"*, logo's waarin DWG het brand-element is.
   - Nominative fair use onder art. 14(1)(c) Verordening (EU) 2017/1001.

3. **Echte clean-room procedure**
   - **Spec-team**: mag ODA Open Design Specification, LibreDWG-documentatie, eigen hex-inspectie van eigen gegenereerde DWG's lezen.
   - **Implementation-team**: schrijft code **zonder ooit** Autodesk-binaries, broncode of SDK te hebben gezien.
   - Documenteer met git-commit-trails, access logs, spec-documenten.
   - Grondslag: HvJ *SAS v WPL* + art. 6 Softwarerichtlijn.

### Restrisico's (vermijdbaar)

- **Octrooien** op specifieke compressie/encryptie-algoritmen in nieuwere DWG-versies (R2007+ met AES). Doe een gerichte FTO-zoekactie op Espacenet (Autodesk patent families, laatste 20 jaar) vóór commerciële release.
- **Risicomitigatie**: ondersteun initieel alleen R14–R2004 (geen encryption).
- **Technological Protection Measures (TPMs)** onder art. 7(1)(c) Softwarerichtlijn: heersende leer is dat omzeiling voor legitieme interoperabiliteit mag, maar niet definitief uitgemaakt.

### Commerciële escape: ODA-lidmaatschap

- Vanaf ~$100/jaar (startup tier) tot ~$850+ (commercieel).
- Royalty-free DWG read+write, productieklare SDK, juridische dekking via ODA-precedent.
- **Pragmatische route** voor commercieel betrouwbare DWG-write zonder zelf 5+ jaar aan implementatiewerk te investeren.

---

## 5. Concrete aanbevelingen voor Open 2D Studio

### Juridische hygiëne nu

1. **Dit document** (`LEGAL.md`) vastleggen in de repo als reference.
2. **Clean-room procedure documenteren** voor `src-tauri/dwg-parser/`:
   - Bronnen: ODA Open Design Specification, LibreDWG docs, eigen hex-inspectie.
   - **Geen** Autodesk binaries, broncode of SDK gebruikt.
   - Scheiding spec/implementation (zelfs als solo-ontwikkelaar: documenteer per commit welke bronnen zijn geraadpleegd).
3. **Creator-string discipline** in de DWG-writer: altijd een neutrale eigen string ("Open 2D Studio vX.Y"), nooit iets met "Autodesk", "AutoCAD" of "Trusted".
4. **Disclaimer in README/About-dialog**:
   > *"DWG and DXF are trademarks of Autodesk, Inc. MicroStation and DGN are trademarks of Bentley Systems, Inc. Open 2D Studio is not affiliated with, endorsed by, or sponsored by Autodesk or Bentley Systems."*

### Pre-release checks

5. **Trademark check EUIPO** (eSearch plus) vóór release — actuele status voor DWG/MicroStation/Bentley registraties in relevante klassen (9, 42).
6. **FTO-octrooianalyse** op Espacenet voor DWG (specifiek R2007+ AES en compressie).
7. **EU IP-advocaat second opinion** (NL/BE, 2–4 uur, ±€500–€1.200) vóór commerciële release, met focus op byte-level keuzes rondom TrustedDWG.

### Fasering naar risico

| Fase | Feature | Risico | Actie |
|---|---|---|---|
| 1 | DXF read/write | Zeer laag | Direct: `dxf` crate |
| 2 | DGN V7 read/write | Laag | Clean-room of GDAL-interface studie |
| 3 | DGN V8 read | Laag | Clean-room op CFBF + ODA spec |
| 4 | DWG read | Gemiddeld | Clean-room met documentatie |
| 5 | DGN V8 write | Laag-gemiddeld | Clean-room óf ODA SDK |
| 6 | DWG write | Gemiddeld | **Separate juridische review**; overweeg ODA SDK |

### Niet doen

- Vertrouwen op LibreDWG alleen (GPL-viraliteit kan Tauri-stack raken; write-support is beperkt).
- "DWG", "DXF" of "DGN" opnemen in productnaam, logo, domeinnaam of app-store-listing.
- Reverse engineering door AutoCAD/MicroStation-installaties te decompileren in plaats van file-samples te bestuderen.
- TrustedDWG-watermark namaken.

---

## 6. Bronnen

### Primaire EU-wetgeving en jurisprudentie

- [Richtlijn 2009/24/EG — EUR-Lex](https://eur-lex.europa.eu/eli/dir/2009/24/oj/eng) (art. 5(3), 6, 8; overwegingen 10, 15)
- Richtlijn (EU) 2016/943 — Trade Secrets, art. 3(1)(b), art. 4
- Verordening (EU) 2017/1001 — EU-merken, art. 14(1)(c)
- Richtlijn 2005/29/EG — Oneerlijke handelspraktijken
- HvJ EU C-406/10 *SAS Institute v WPL* (2 mei 2012)
- HvJ EU C-393/09 *BSA v Ministerstvo kultury* (22 december 2010)
- HvJ EU C-13/20 *Top System v Belgische Staat* (6 oktober 2021)
- HvJ EU C-5/08 *Infopaq International* (16 juli 2009)
- Nederlandse Auteurswet art. 45m, 45n

### Autodesk / DWG / DXF

- [Autodesk Trademark Guidelines](https://www.autodesk.com/company/legal-notices-trademarks/trademarks/guidelines-for-use)
- [Autodesk Legal Notices & Trademarks](https://www.autodesk.com/company/legal-notices-trademarks)
- [Autodesk + ODA Agreement (2010)](https://investors.autodesk.com/news-releases/news-release-details/autodesk-and-open-design-alliance-reach-agreement-autodesk-dwg)
- [Autodesk DXF Reference — CloudHelp](https://help.autodesk.com/view/OARX/2024/ENU/?guid=GUID-235B22E0-A567-4CF6-92D3-38A2306D73F3)
- [AutoCAD DXF Archive (R12–2014)](https://damassets.autodesk.net/content/dam/autodesk/www/developer-network/platform-technologies/autocad-dxf-archive/acad_r12_dxf.pdf)
- [TrustedDWG — AutoCAD Blog](https://www.autodesk.com/blogs/autocad/trusteddwg-exploring-features-benefits-autocad/)

### Open Design Alliance

- [ODA Homepage](https://www.opendesign.com/)
- [ODA Pricing](https://www.opendesign.com/pricing)
- [ODA Trademark Disclosure](https://www.opendesign.com/trademark)
- [Wikipedia — Open Design Alliance](https://en.wikipedia.org/wiki/Open_Design_Alliance)

### Juridische analyses

- [EFF — Using Trademark to Stymie Interoperability?](https://www.eff.org/deeplinks/2006/12/using-trademark-stymie-interoperability)
- [Kluwer Copyright Blog — Decrypting the code: CJEU SAS vs. WPL](https://copyrightblog.kluweriplaw.com/2012/05/07/decrypting-the-code-cjeu-sas-vs-world-programming/)
- [Pinsent Masons — Computer program functionality not copyrightable](https://www.pinsentmasons.com/out-law/news/computer-program-functionality-not-copyrightable-but-programming-languages-and-file-formats-may-be-protected-by-the-copyright-directive)
- [Gerrish Legal — Reverse Engineering: When Can Users Lawfully Decompile Software?](https://www.gerrishlegal.com/blog/2020/04/16/2020-4-7-reverse-engineering-when-can-users-lawfully-decompile-software)

### Praktijk

- [GNU LibreDWG](https://www.gnu.org/software/libredwg/)
- [ezdxf documentation](https://ezdxf.readthedocs.io/en/stable/)
- [libdxfrw (GPL v2)](https://github.com/codelibs/libdxfrw)
- [OSArch Wiki — ODA](https://wiki.osarch.org/index.php?title=Open_Design_Alliance_(ODA))
- [OSArch Wiki — DWG](https://wiki.osarch.org/index.php?title=Drawing_(DWG))
- [Library of Congress — DWG Format Family](https://www.loc.gov/preservation/digital/formats/fdd/fdd000445.shtml)
- [EUIPO eSearch plus](https://euipo.europa.eu/eSearch/)
- [Espacenet — EPO patent search](https://worldwide.espacenet.com/)

---

## Disclaimer

Dit document is een **onderzoeksrapport**, opgesteld ten behoeve van architecturale besluitvorming binnen het Open 2D Studio project. Het vormt **geen formeel juridisch advies**.

Voor commerciële distributie van DWG write-functionaliteit in de EU wordt sterk aanbevolen:

1. Een **EU IP-advocaat** (Nederland/België) een formele second opinion te laten schrijven, met name rond:
   - De specifieke byte-level keuzes rondom de TrustedDWG-bytes.
   - De branding en marketing van Open 2D Studio.
   - Een actuele trademark-status check bij EUIPO.
2. Een **patent freedom-to-operate (FTO) analyse** op Espacenet voor Autodesk en Bentley patent families.

Geschatte kosten: 2–4 uur consult (±€500–€1.200) voor het juridische advies; FTO-analyse afhankelijk van diepgang.

---

*Laatst bijgewerkt: 2026-04-21*
