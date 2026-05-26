# YOLO Weights — `weights/model.pt`

This folder holds the trained YOLOv8 model that the worker pipeline loads.

## What is this file?

- **Model:** YOLOv8 **Small** variant (PyTorch `.pt` format, Ultralytics).
- **Size:** ~85.4 MB (86 MB nominal).
- **Training dataset:** Road-anomaly dataset from [`collabdoor/road-anomaly-detection`](https://github.com/collabdoor/road-anomaly-detection).
- **Classes in the model:**
  | Class ID | Name |
  |---|---|
  | 0 | Longitudinal Crack |
  | 1 | Transverse Crack |
  | 2 | Alligator Crack |
  | 3 | **Potholes** ← only class RoadSenseAI uses |
- **How it is used:** `worker/pipeline/yolo_inference.py` filters predictions to class names containing `"pothole"`. All other classes are discarded, and can be used in future work.

## Where is it expected?

The worker loads it from the path in `worker/.env`:

```
YOLO_WEIGHTS_PATH=../weights/model.pt
```

So the resolved absolute path must be:

```
<project-root>/weights/model.pt
```

## Distribution

`weights/model.pt` is in `.gitignore` for hygiene; it is not committed to source control. The file (~89 MB) must be placed at `weights/model.pt` before the worker can run inference.

## Verify the file

On Windows PowerShell:

```powershell
Get-Item weights\model.pt | Select-Object Length
# Expected: Length ≈ 89,569,358 bytes  (~85.4 MB)
```

If the file is missing or the size is clearly wrong (for example under 50 MB), contact the project owner for a fresh copy of `model.pt`. Do NOT attempt to redownload from an unrelated source — the class indices and postprocessing are tuned to this specific weights file.

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| Worker logs `FileNotFoundError: ../weights/model.pt` | File missing from backup / didn't ship with folder | Request a fresh copy from the project owner. |
| Worker logs `_pickle.UnpicklingError` or `RuntimeError: [enforce fail ...]` | Corrupted file (partial copy, wrong transfer mode) | Redownload / recopy; verify size matches the Expected value above. |
| `weights\model.pt | Select-Object Length` shows something far from 85 MB | File replaced with wrong model | Replace with the correct file. |
| `./scripts/start.ps1` exits with `weights/model.pt missing or too small` | The script's sanity check triggered | Same — fix the file, then rerun. |
