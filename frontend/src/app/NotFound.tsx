import { Link } from "react-router";

export function NotFound() {
  return (
    <div className="p-8">
      <h1 className="text-xl font-semibold">Page not found</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        This page doesn't exist. <Link className="text-primary underline underline-offset-4" to="/calendar">Go to the calendar</Link>
      </p>
    </div>
  );
}
