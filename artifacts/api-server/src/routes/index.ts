import { Router, type IRouter } from "express";
import healthRouter from "./health";
import alertRouter from "./alert";

const router: IRouter = Router();

router.use(healthRouter);
router.use(alertRouter);

export default router;
