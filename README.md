### Student Grouping App (Browser-only)

Create balanced student groups from a CSV, ensuring each group contains at least one student from every study program. Entirely static; works on GitHub Pages or by opening the `docs/index.html` file locally.

### Features
- Load students from CSV (`name,program`)
- Choose maximum students per group
- Enforce that every group has all study programs represented
- Optional seed for deterministic shuffling
- Manual drag-and-drop editing, per-student locking, and reshuffle that respects locks
- Export groups to JSON or CSV

### Run locally
- Open `docs/index.html` in your browser, or serve the `docs/` folder via any static server.

### Deploy to GitHub Pages
1) Commit and push the repo
2) In GitHub → Settings → Pages: set Source to “Deploy from a branch”, Folder to `/docs`
3) Visit the published URL

### CSV format
```
name,program
Alice,CS
Bob,Math
Charlie,Physics
```

### Notes
- Grouping requires that `group_size >= number_of_programs` and each program has at least `number_of_groups` students.
- If constraints cannot be met, the app shows a clear error.


