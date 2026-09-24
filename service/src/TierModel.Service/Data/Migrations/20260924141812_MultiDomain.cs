using System;
using Microsoft.EntityFrameworkCore.Migrations;
using Npgsql.EntityFrameworkCore.PostgreSQL.Metadata;

#nullable disable

namespace TierModel.Service.Data.Migrations
{
    /// <inheritdoc />
    public partial class MultiDomain : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "FK_config_versions_config_sections_SectionKey",
                table: "config_versions");

            migrationBuilder.DropIndex(
                name: "IX_jit_groups_Group",
                table: "jit_groups");

            migrationBuilder.DropIndex(
                name: "IX_config_versions_SectionKey_Version",
                table: "config_versions");

            migrationBuilder.DropPrimaryKey(
                name: "PK_config_sections",
                table: "config_sections");

            migrationBuilder.AddColumn<int>(
                name: "DomainId",
                table: "schedules",
                type: "integer",
                nullable: false,
                defaultValue: 1);

            migrationBuilder.AddColumn<int>(
                name: "DomainId",
                table: "runs",
                type: "integer",
                nullable: false,
                defaultValue: 1);

            migrationBuilder.AddColumn<int[]>(
                name: "DomainIds",
                table: "maintenance_windows",
                type: "integer[]",
                nullable: false,
                defaultValueSql: "'{}'::integer[]");

            migrationBuilder.AddColumn<int>(
                name: "DomainId",
                table: "jit_requests",
                type: "integer",
                nullable: false,
                defaultValue: 1);

            migrationBuilder.AddColumn<int>(
                name: "DomainId",
                table: "jit_groups",
                type: "integer",
                nullable: false,
                defaultValue: 1);

            migrationBuilder.AddColumn<int[]>(
                name: "DomainIds",
                table: "freeze_periods",
                type: "integer[]",
                nullable: false,
                defaultValueSql: "'{}'::integer[]");

            migrationBuilder.AddColumn<int>(
                name: "DomainId",
                table: "config_versions",
                type: "integer",
                nullable: false,
                defaultValue: 1);

            migrationBuilder.AddColumn<int>(
                name: "DomainId",
                table: "config_sections",
                type: "integer",
                nullable: false,
                defaultValue: 1);

            migrationBuilder.AddPrimaryKey(
                name: "PK_config_sections",
                table: "config_sections",
                columns: new[] { "DomainId", "Key" });

            migrationBuilder.CreateTable(
                name: "domains",
                columns: table => new
                {
                    Id = table.Column<int>(type: "integer", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    Key = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: false),
                    DisplayName = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: false),
                    DnsName = table.Column<string>(type: "character varying(253)", maxLength: 253, nullable: false),
                    PreferredDc = table.Column<string>(type: "character varying(253)", maxLength: 253, nullable: false),
                    AdmlLanguage = table.Column<string>(type: "character varying(5)", maxLength: 5, nullable: false),
                    Enabled = table.Column<bool>(type: "boolean", nullable: false),
                    IsDefault = table.Column<bool>(type: "boolean", nullable: false),
                    CreatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    Notes = table.Column<string>(type: "character varying(1000)", maxLength: 1000, nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_domains", x => x.Id);
                });

            // The existing data belongs to the first domain: DC and ADML language from the former instance settings,
            // DNS name from the DC name (dc01.contoso.com → contoso.com), short name from its first label.
            migrationBuilder.Sql("""
                WITH s AS (
                    SELECT btrim(coalesce((SELECT "Value" FROM settings WHERE "Key" = 'defaultPreferredDc'), '')) AS dc,
                           btrim(coalesce((SELECT "Value" FROM settings WHERE "Key" = 'admlLanguage'), '')) AS lang
                ), d AS (
                    SELECT dc, lang,
                           CASE WHEN strpos(dc, '.') > 0 THEN lower(substr(dc, strpos(dc, '.') + 1)) ELSE '' END AS dns
                    FROM s
                ), k AS (
                    SELECT dc, lang, dns,
                           left(btrim(regexp_replace(lower(split_part(dns, '.', 1)), '[^a-z0-9-]', '', 'g'), '-'), 32) AS key
                    FROM d
                )
                INSERT INTO domains ("Id", "Key", "DisplayName", "DnsName", "PreferredDc", "AdmlLanguage", "Enabled", "IsDefault", "CreatedAt", "Notes")
                OVERRIDING SYSTEM VALUE
                SELECT 1,
                       CASE WHEN key = '' OR key IN ('config', 'api', 'all', 'alle', 'default', 'versions') THEN 'standard' ELSE key END,
                       CASE WHEN dns = '' THEN 'Standard-Domäne' ELSE dns END,
                       dns, dc, CASE WHEN lang ~ '^[A-Za-z]{2}-[A-Za-z]{2}$' THEN lang ELSE 'en-US' END,
                       true, true, now(), 'Bei der Umstellung auf mehrere Domänen aus den bisherigen Einstellungen übernommen.'
                FROM k;
                SELECT setval(pg_get_serial_sequence('domains', 'Id'), (SELECT max("Id") FROM domains));
                """);

            migrationBuilder.CreateIndex(
                name: "IX_schedules_DomainId",
                table: "schedules",
                column: "DomainId");

            migrationBuilder.CreateIndex(
                name: "IX_runs_DomainId_Id",
                table: "runs",
                columns: new[] { "DomainId", "Id" });

            migrationBuilder.CreateIndex(
                name: "IX_jit_requests_DomainId_Id",
                table: "jit_requests",
                columns: new[] { "DomainId", "Id" });

            migrationBuilder.CreateIndex(
                name: "IX_jit_groups_DomainId_Group",
                table: "jit_groups",
                columns: new[] { "DomainId", "Group" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_config_versions_DomainId_SectionKey_Version",
                table: "config_versions",
                columns: new[] { "DomainId", "SectionKey", "Version" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_domains_IsDefault",
                table: "domains",
                column: "IsDefault",
                unique: true,
                filter: "\"IsDefault\"");

            migrationBuilder.CreateIndex(
                name: "IX_domains_Key",
                table: "domains",
                column: "Key",
                unique: true);

            migrationBuilder.AddForeignKey(
                name: "FK_config_sections_domains_DomainId",
                table: "config_sections",
                column: "DomainId",
                principalTable: "domains",
                principalColumn: "Id",
                onDelete: ReferentialAction.Restrict);

            migrationBuilder.AddForeignKey(
                name: "FK_config_versions_config_sections_DomainId_SectionKey",
                table: "config_versions",
                columns: new[] { "DomainId", "SectionKey" },
                principalTable: "config_sections",
                principalColumns: new[] { "DomainId", "Key" },
                onDelete: ReferentialAction.Cascade);

            migrationBuilder.AddForeignKey(
                name: "FK_jit_groups_domains_DomainId",
                table: "jit_groups",
                column: "DomainId",
                principalTable: "domains",
                principalColumn: "Id",
                onDelete: ReferentialAction.Restrict);

            migrationBuilder.AddForeignKey(
                name: "FK_jit_requests_domains_DomainId",
                table: "jit_requests",
                column: "DomainId",
                principalTable: "domains",
                principalColumn: "Id",
                onDelete: ReferentialAction.Restrict);

            migrationBuilder.AddForeignKey(
                name: "FK_privileged_snapshots_domains_DomainId",
                table: "privileged_snapshots",
                column: "DomainId",
                principalTable: "domains",
                principalColumn: "Id",
                onDelete: ReferentialAction.Restrict);

            migrationBuilder.AddForeignKey(
                name: "FK_runs_domains_DomainId",
                table: "runs",
                column: "DomainId",
                principalTable: "domains",
                principalColumn: "Id",
                onDelete: ReferentialAction.Restrict);

            migrationBuilder.AddForeignKey(
                name: "FK_schedules_domains_DomainId",
                table: "schedules",
                column: "DomainId",
                principalTable: "domains",
                principalColumn: "Id",
                onDelete: ReferentialAction.Restrict);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            // Only the first domain fits the single-domain schema.
            migrationBuilder.Sql("""
                DELETE FROM jit_requests WHERE "DomainId" <> 1;
                DELETE FROM jit_groups WHERE "DomainId" <> 1;
                DELETE FROM runs WHERE "DomainId" <> 1;
                DELETE FROM schedules WHERE "DomainId" <> 1;
                DELETE FROM config_versions WHERE "DomainId" <> 1;
                DELETE FROM config_sections WHERE "DomainId" <> 1;
                DELETE FROM privileged_snapshots WHERE "DomainId" <> 1;
                """);

            migrationBuilder.DropForeignKey(
                name: "FK_config_sections_domains_DomainId",
                table: "config_sections");

            migrationBuilder.DropForeignKey(
                name: "FK_config_versions_config_sections_DomainId_SectionKey",
                table: "config_versions");

            migrationBuilder.DropForeignKey(
                name: "FK_jit_groups_domains_DomainId",
                table: "jit_groups");

            migrationBuilder.DropForeignKey(
                name: "FK_jit_requests_domains_DomainId",
                table: "jit_requests");

            migrationBuilder.DropForeignKey(
                name: "FK_privileged_snapshots_domains_DomainId",
                table: "privileged_snapshots");

            migrationBuilder.DropForeignKey(
                name: "FK_runs_domains_DomainId",
                table: "runs");

            migrationBuilder.DropForeignKey(
                name: "FK_schedules_domains_DomainId",
                table: "schedules");

            migrationBuilder.DropTable(
                name: "domains");

            migrationBuilder.DropIndex(
                name: "IX_schedules_DomainId",
                table: "schedules");

            migrationBuilder.DropIndex(
                name: "IX_runs_DomainId_Id",
                table: "runs");

            migrationBuilder.DropIndex(
                name: "IX_jit_requests_DomainId_Id",
                table: "jit_requests");

            migrationBuilder.DropIndex(
                name: "IX_jit_groups_DomainId_Group",
                table: "jit_groups");

            migrationBuilder.DropIndex(
                name: "IX_config_versions_DomainId_SectionKey_Version",
                table: "config_versions");

            migrationBuilder.DropPrimaryKey(
                name: "PK_config_sections",
                table: "config_sections");

            migrationBuilder.DropColumn(
                name: "DomainId",
                table: "schedules");

            migrationBuilder.DropColumn(
                name: "DomainId",
                table: "runs");

            migrationBuilder.DropColumn(
                name: "DomainIds",
                table: "maintenance_windows");

            migrationBuilder.DropColumn(
                name: "DomainId",
                table: "jit_requests");

            migrationBuilder.DropColumn(
                name: "DomainId",
                table: "jit_groups");

            migrationBuilder.DropColumn(
                name: "DomainIds",
                table: "freeze_periods");

            migrationBuilder.DropColumn(
                name: "DomainId",
                table: "config_versions");

            migrationBuilder.DropColumn(
                name: "DomainId",
                table: "config_sections");

            migrationBuilder.AddPrimaryKey(
                name: "PK_config_sections",
                table: "config_sections",
                column: "Key");

            migrationBuilder.CreateIndex(
                name: "IX_jit_groups_Group",
                table: "jit_groups",
                column: "Group",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_config_versions_SectionKey_Version",
                table: "config_versions",
                columns: new[] { "SectionKey", "Version" },
                unique: true);

            migrationBuilder.AddForeignKey(
                name: "FK_config_versions_config_sections_SectionKey",
                table: "config_versions",
                column: "SectionKey",
                principalTable: "config_sections",
                principalColumn: "Key",
                onDelete: ReferentialAction.Cascade);
        }
    }
}
