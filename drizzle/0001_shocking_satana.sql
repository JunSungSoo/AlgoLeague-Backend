CREATE UNIQUE INDEX "assignments_user_problem_uq" ON "assignments" USING btree ("user_id","problem_id");
