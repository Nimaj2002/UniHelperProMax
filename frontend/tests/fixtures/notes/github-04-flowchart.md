# Build pipeline

```mermaid
flowchart LR
  A[Commit] --> B{Tests pass?}
  B -- yes --> C[Deploy]
  B -- no --> D[Fix_it *now*]
```
