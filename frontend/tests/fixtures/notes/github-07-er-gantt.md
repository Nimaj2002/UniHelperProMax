```mermaid
erDiagram
  STUDENT ||--o{ ENROLLMENT : has
  COURSE ||--o{ ENROLLMENT : includes
```

```mermaid
gantt
  title Semester plan
  dateFormat YYYY-MM-DD
  section Exams
  Midterm :a1, 2026-11-02, 1d
  Final   :after a1, 30d
```
