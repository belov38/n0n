CREATE TABLE "credential" (
	"id" varchar(36) PRIMARY KEY NOT NULL,
	"name" varchar(128) NOT NULL,
	"type" varchar(128) NOT NULL,
	"data" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "execution_data" (
	"execution_id" integer PRIMARY KEY NOT NULL,
	"workflow_data" jsonb NOT NULL,
	"data" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "execution_metadata" (
	"id" serial PRIMARY KEY NOT NULL,
	"execution_id" integer NOT NULL,
	"key" varchar(255) NOT NULL,
	"value" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "execution" (
	"id" serial PRIMARY KEY NOT NULL,
	"workflow_id" varchar(36) NOT NULL,
	"status" varchar(20) NOT NULL,
	"mode" varchar(20) NOT NULL,
	"finished" boolean DEFAULT false NOT NULL,
	"started_at" timestamp with time zone,
	"stopped_at" timestamp with time zone,
	"wait_till" timestamp with time zone,
	"retry_of" varchar(36),
	"retry_success_id" varchar(36),
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "folder" (
	"id" varchar(36) PRIMARY KEY NOT NULL,
	"name" varchar(128) NOT NULL,
	"parent_folder_id" varchar(36),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "processed_data" (
	"id" serial PRIMARY KEY NOT NULL,
	"workflow_id" varchar(36) NOT NULL,
	"context" varchar(255) NOT NULL,
	"value" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "settings" (
	"key" varchar(255) PRIMARY KEY NOT NULL,
	"value" text NOT NULL,
	"load_on_startup" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tag" (
	"id" varchar(36) PRIMARY KEY NOT NULL,
	"name" varchar(24) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "variable" (
	"id" serial PRIMARY KEY NOT NULL,
	"key" varchar(255) NOT NULL,
	"value" text NOT NULL,
	"type" varchar(32) DEFAULT 'string' NOT NULL,
	CONSTRAINT "variable_key_unique" UNIQUE("key")
);
--> statement-breakpoint
CREATE TABLE "webhook" (
	"workflow_id" varchar(36) NOT NULL,
	"webhook_path" varchar(255) NOT NULL,
	"method" varchar(10) NOT NULL,
	"node" varchar(255) NOT NULL,
	"webhook_id" varchar(36),
	"path_length" integer,
	CONSTRAINT "webhook_webhook_path_method_pk" PRIMARY KEY("webhook_path","method")
);
--> statement-breakpoint
CREATE TABLE "workflow" (
	"id" varchar(36) PRIMARY KEY NOT NULL,
	"name" varchar(128) NOT NULL,
	"active" boolean DEFAULT false NOT NULL,
	"nodes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"connections" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"settings" jsonb,
	"static_data" jsonb,
	"pin_data" jsonb,
	"version_id" varchar(36) NOT NULL,
	"trigger_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workflow_history" (
	"version_id" varchar(36) PRIMARY KEY NOT NULL,
	"workflow_id" varchar(36) NOT NULL,
	"nodes" jsonb NOT NULL,
	"connections" jsonb NOT NULL,
	"authors" varchar(256) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workflow_statistics" (
	"id" serial PRIMARY KEY NOT NULL,
	"workflow_id" varchar(36) NOT NULL,
	"name" varchar(128) NOT NULL,
	"count" integer DEFAULT 0 NOT NULL,
	"latest_event" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "workflow_tag_mapping" (
	"workflow_id" varchar(36) NOT NULL,
	"tag_id" varchar(36) NOT NULL,
	CONSTRAINT "workflow_tag_mapping_workflow_id_tag_id_pk" PRIMARY KEY("workflow_id","tag_id")
);
--> statement-breakpoint
ALTER TABLE "execution_data" ADD CONSTRAINT "execution_data_execution_id_execution_id_fk" FOREIGN KEY ("execution_id") REFERENCES "public"."execution"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "execution_metadata" ADD CONSTRAINT "execution_metadata_execution_id_execution_id_fk" FOREIGN KEY ("execution_id") REFERENCES "public"."execution"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "execution" ADD CONSTRAINT "execution_workflow_id_workflow_id_fk" FOREIGN KEY ("workflow_id") REFERENCES "public"."workflow"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "folder" ADD CONSTRAINT "folder_parent_folder_id_folder_id_fk" FOREIGN KEY ("parent_folder_id") REFERENCES "public"."folder"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "processed_data" ADD CONSTRAINT "processed_data_workflow_id_workflow_id_fk" FOREIGN KEY ("workflow_id") REFERENCES "public"."workflow"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhook" ADD CONSTRAINT "webhook_workflow_id_workflow_id_fk" FOREIGN KEY ("workflow_id") REFERENCES "public"."workflow"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_history" ADD CONSTRAINT "workflow_history_workflow_id_workflow_id_fk" FOREIGN KEY ("workflow_id") REFERENCES "public"."workflow"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_statistics" ADD CONSTRAINT "workflow_statistics_workflow_id_workflow_id_fk" FOREIGN KEY ("workflow_id") REFERENCES "public"."workflow"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_tag_mapping" ADD CONSTRAINT "workflow_tag_mapping_workflow_id_workflow_id_fk" FOREIGN KEY ("workflow_id") REFERENCES "public"."workflow"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_tag_mapping" ADD CONSTRAINT "workflow_tag_mapping_tag_id_tag_id_fk" FOREIGN KEY ("tag_id") REFERENCES "public"."tag"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_execution_workflow_id" ON "execution" USING btree ("workflow_id","id");--> statement-breakpoint
CREATE INDEX "idx_execution_wait_till" ON "execution" USING btree ("wait_till","id");--> statement-breakpoint
CREATE INDEX "idx_execution_finished" ON "execution" USING btree ("finished","id");--> statement-breakpoint
CREATE INDEX "idx_execution_workflow_finished" ON "execution" USING btree ("workflow_id","finished","id");--> statement-breakpoint
CREATE INDEX "idx_execution_workflow_wait_till" ON "execution" USING btree ("workflow_id","wait_till","id");--> statement-breakpoint
CREATE INDEX "idx_execution_stopped_at" ON "execution" USING btree ("stopped_at");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_processed_data_workflow_context" ON "processed_data" USING btree ("workflow_id","context");--> statement-breakpoint
CREATE UNIQUE INDEX "tag_name_idx" ON "tag" USING btree ("name");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_workflow_statistics_workflow_name" ON "workflow_statistics" USING btree ("workflow_id","name");