---
name: git-deploy-workflow
description: >-
  Standardized git and deployment workflow for MyDuit PWA. Use for executing atomic
  commits, branch-based feature development, quality gate validation, and direct deployment
  to Firebase Hosting without repetitive confirmation prompts.
---

# Git & Deployment Workflow Guide

Alur kerja standar Git dan deployment untuk proyek MyDuit Progressive Web App (PWA).

## 1. Prinsip Utama Alur Kerja
- **Atomic Commits (1 per 1)**: Jangan menumpuk perubahan multi-fitur ke dalam satu commit besar. Pisahkan commit per modul/fitur secara mandiri dengan pesan deskriptif bahasa Indonesia.
- **Sistem Branching**:
  - Untuk tugas berisiko tinggi atau eksperimen fitur baru, buat branch baru terlebih dahulu:
    ```bash
    git checkout -b feat/<nama-fitur>
    ```
  - Setelah semua verifikasi lolos, switch kembali ke `main` dan merge:
    ```bash
    git checkout main
    git merge feat/<nama-fitur>
    git branch -d feat/<nama-fitur>
    ```
- **Tanpa Konfirmasi Berulang (Autonomous Execution)**:
  - Jalankan pengujian & verifikasi secara deterministik (`npm run check`).
  - Bila lolos, langsung commit 1 per 1 dan push ke remote `main`.
  - Langsung jalankan deployment ke Firebase Hosting.

## 2. Gate Kualitas Sebelum Commit & Deploy
Setiap perubahan wajib memenuhi standar berikut:
1. Jalankan 19 test suite:
   ```bash
   npm run check
   ```
2. Pastikan build bundle Vite produksi sukses (`dist/` ter-generate bersama Service Worker PWA).
3. Jalankan visual regression check bila ada perubahan UI (`node dogfood_runner.mjs`).

## 3. Deployment Langsung ke Firebase Hosting
Setelah push ke remote repository:
```bash
npm run deploy:hosting
```
Pastikan deployment berhasil dengan target authorized domain: `https://myduit001.web.app`.
