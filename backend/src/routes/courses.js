import { Router } from "express";
import { HttpError } from "../errors.js";
import { courseMetaBody, parse, uintId } from "../validation.js";

export function courseRoutes({ chain, store, requireAdmin }) {
  const router = Router();

  router.put("/courses/:id/meta", requireAdmin, async (req, res) => {
    const courseId = parse(uintId, req.params.id, "id");
    const { title, room, schedule } = parse(courseMetaBody, req.body, "body");
    if (courseId > (await chain.manager.courseCount())) {
      throw new HttpError(404, "course_not_found", `Course ${courseId} does not exist`);
    }

    const key = courseId.toString();
    const meta = await store.update((state) => {
      state.courses[key] = {
        title,
        ...(room && { room }),
        ...(schedule && { schedule }),
        updatedAt: new Date().toISOString(),
      };
      return state.courses[key];
    });
    res.json({ courseId: key, ...meta });
  });

  router.get("/courses/:id/meta", (req, res) => {
    const key = parse(uintId, req.params.id, "id").toString();
    const meta = store.read().courses[key];
    if (!meta) throw new HttpError(404, "course_meta_not_found", "No details saved for this course");
    res.json({ courseId: key, ...meta });
  });

  return router;
}
