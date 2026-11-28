"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export function HomeworkReviewRefresh() {
  const router = useRouter();
  useEffect(() => {
    const stream = new EventSource("/api/teacher/homework/events");
    const refresh = () => router.refresh();
    // Read the current server data on reconnect because events can be missed.
    stream.onopen = refresh;
    stream.addEventListener("homeworkRevision", refresh);
    return () => stream.close();
  }, [router]);
  return null;
}
