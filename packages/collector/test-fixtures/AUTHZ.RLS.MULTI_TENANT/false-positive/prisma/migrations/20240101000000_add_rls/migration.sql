-- RLS policies for tenant isolation

-- Session context function
CREATE OR REPLACE FUNCTION current_organization_id()
RETURNS TEXT AS $$
BEGIN
  RETURN current_setting('app.current_organization_id', true);
END;
$$ LANGUAGE plpgsql STABLE;

-- Enable RLS on Project
ALTER TABLE "Project" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "project_tenant_isolation" ON "Project"
  USING ("organizationId" = current_organization_id())
  WITH CHECK ("organizationId" = current_organization_id());

-- Enable RLS on Member
ALTER TABLE "Member" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "member_tenant_isolation" ON "Member"
  USING ("organizationId" = current_organization_id())
  WITH CHECK ("organizationId" = current_organization_id());

-- Task is protected via Project FK (can optionally add policy)
ALTER TABLE "Task" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "task_tenant_isolation" ON "Task"
  USING (
    EXISTS (
      SELECT 1 FROM "Project"
      WHERE "Project"."id" = "Task"."projectId"
        AND "Project"."organizationId" = current_organization_id()
    )
  );
