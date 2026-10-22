# Third-party notices

| component | path | upstream | license |
|---|---|---|---|
| RelateAnything relation model (DINOv3 ViT-S+/16 backbone + relation head) | `models/relateanything_vits16plus_w16.*` | Meta DINOv3 pretrained weights (`facebook/dinov3-vits16plus-pretrain-lvd1689m`) | [DINOv3 License](https://ai.meta.com/resources/models-and-libraries/dinov3-license/) — derivative; the license travels with the artifact |
| Predicate text encoder (student distilled from dino.txt) + predicate bank | `models/predicate_encoder_w16.onnx`, `assets/banks/predicate_bank.json` | Meta dino.txt (DINOv3 text tower) outputs; OpenAI CLIP BPE tokenizer | DINOv3 License (distillation derivative); tokenizer files MIT |
| YOLOE-11s (prompt-free and text-prompt) | `models/yoloe-11s-pf.*`, `models/yoloe-11s-text.*` | `ultralytics/assets` `yoloe-11s-seg-pf.pt`, `yoloe-11s-seg.pt` (ultralytics 8.4.101) | **AGPL-3.0** |
| YOLO-World v2-S re-parameterised to MEGASG-497 | `models/yoloworld-s-megasg497.*` | `ultralytics/assets` `yolov8s-worldv2.pt` | **AGPL-3.0** |
| YOLO26 n/s and YOLO26s-seg | `models/yolo26n.*`, `models/yolo26s.*`, `models/yolo26s-seg.*` | `ultralytics/assets` `yolo26n.pt`, `yolo26s.pt`, `yolo26s-seg.pt` | **AGPL-3.0** |
| YOLO12s | `models/yolo12s.*` | `ultralytics/assets` `yolo12s.pt` (ultralytics 8.4.101) | **AGPL-3.0** |
| FastSAM-s | `models/fastsam-s.*` | `ultralytics/assets` `FastSAM-s.pt` (ultralytics 8.4.101) | **AGPL-3.0** |
| MobileCLIP-BLT text encoder + class bank | `models/mobileclip_blt_text_w16.*`, `assets/banks/yoloe-11s_classbank.*` | Apple `ml-mobileclip` (via `ultralytics/assets` `mobileclip_blt.ts`, text tower only) | [Apple MobileCLIP weights license](https://github.com/apple/ml-mobileclip/blob/main/LICENSE_MODELS) |
| Class-name lists | `models/*.classes.json`, bank names | COCO, Objects365, LVIS, Open Images V7 (via ultralytics dataset yamls), MEGASG | dataset terms; names only |
| onnxruntime-web 1.29.0 | `vendor/ort/` | Microsoft | MIT |
| coi-serviceworker 0.1.7 | `coi-serviceworker.js` | Guido Zuidhof | MIT |
| Sample photos | `assets/samples/` | Wikimedia Commons (see `assets/samples/credits.json`) | CC0 / CC BY 2.0 / CC BY-SA 4.0 as listed |

The AGPL-3.0 detectors are distributed as separate model files that this page loads
at runtime; the corresponding source is the ultralytics repository at the version
named above plus the export script in the research repository
(`deploy/web/export_web_models.py`). If you need a detector under different terms,
bring your own ONNX detector with the `boxes/conf/cls` or `[N,6]` output layout.
