# Android-AI-Health

Android-only Flutter health management app focused on multi-member health data, AI-assisted report extraction, supplement slot binding, device sync, and real-time plan recomputation.

## Current focus
- Cloud-first data flow inside the app service layer
- Multi-member isolation by `user_id`
- Real-time plan recomputation after report, daily status, slot binding, or device changes
- AI-assisted supplement recognition and structured report extraction
- Chinese-first UI with optional English switch

## Main capabilities
- Member management with per-member isolated data
- Hospital body composition report upload and structured confirmation
- Body fat test report upload and structured confirmation
- Supplement recognition with A-F slot binding and nutrient persistence
- Daily status prompt with automatic plan refresh
- Private doctor chat driven by current member data
- Device sync driving dashboard and plan updates
- Version log page backed by stored data

## Workspace structure
- `android/`: Android host project
- `lib/`: Flutter application code
- `assets/`: knowledge base and seed data
- `test/`: tests
- `docs/`: current product, engineering, and ops docs
- `ops/`: local scripts and operational helpers
- `archive/`: old platform shells, experiments, and legacy material
- `.artifacts/`: large local files and temporary artifacts

## Key docs
- [Product PRD](docs/product/PRD.md)
- [Implementation Status](docs/product/IMPLEMENTATION_STATUS.md)
- [Architecture](docs/engineering/ARCHITECTURE.md)
- [AI Pipelines](docs/engineering/AI_PIPELINES.md)
- [Deployment](docs/ops/DEPLOYMENT.md)
- [Troubleshooting](docs/ops/TROUBLESHOOTING.md)
- [APK Distribution](docs/ops/APK_DISTRIBUTION.md)

## Local development
```powershell
cd D:\Android-AI-Health
D:\flutter\bin\flutter.bat pub get
D:\flutter\bin\flutter.bat run -d <device-id>
```

Hot reload inside the running `flutter run` terminal:
- `r`: hot reload
- `R`: hot restart
- `q`: quit

## Notes
- Non-Android platform folders and historical materials were moved out of the main root to reduce noise.
- Large local SDK archives and temporary outputs are kept in `.artifacts/`.
- Old delivery and deployment notes were archived under `docs/archive/2026-03/`.
