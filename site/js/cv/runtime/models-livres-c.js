/**
 * Modelos livres — grupo C (ver o comentário em onnx.js).
 *
 * Os modelos do CV-24 (RF-DETR e PatchCore treinados em /treino/) não têm lista fixa: cada treino publica
 * /models/custom/<id>.onnx e uma ficha em /models/custom/index.json, e operators/livres-c.js registra o
 * modelo em MODELS como 'livre:<id>' na hora do uso. Por isso este catálogo fica vazio.
 * Licenças: RF-DETR Apache-2.0 (Roboflow; backbone DINOv2 Apache-2.0); PatchCore Apache-2.0 (implementação
 * GPlanSiS; ResNet-18 torchvision BSD-3-Clause, pesos ImageNet).
 */
export default {};
