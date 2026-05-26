Disease: Oncology / "oncology" / priority 3
Keywords: cancer, tumor, malignant, carcinoma, chemo, chemotherapy, radiation, 
          biopsy, oncology, neoplasm, metastasis, mastectomy, lumpectomy, ...

Admissibility rules:
- Pre-existing cancer waiting period: 4 years (rejection: "Pre-existing cancer 
  requires 4 years continuous coverage")
- Cosmetic reconstruction excluded: if diagnosis includes "reconstruction" and 
  is post-mastectomy beyond 6 months
- ... etc

AI extraction:
- cancerStage (I/II/III/IV)
- tumorType
- treatmentLine (1st/2nd/3rd line)
- isMetastatic (boolean)

TPA mappings:
- Chemotherapy / IDs around 700-710 / catchAll 700
- Radiation therapy / IDs 720-725 / catchAll 720
- Biopsy / ID 730
- Surgery (lumpectomy/mastectomy) / IDs 740-745
...

Coding row:
- BillingType: 201 (bill + package, like cataract)
- TreatmentType: 66 (mostly surgical) — except for chemo which is medical (67)
                 — handle this how?
- DefaultFacilityId: null
- PackageRateNull: false

UI:
- showInadmissibilityFlags: yes
- showGPLA: no
- filterAilmentCappings: yes
- showEyeFields: no
- Anything else? Maybe a "stage selector" widget — TBD
