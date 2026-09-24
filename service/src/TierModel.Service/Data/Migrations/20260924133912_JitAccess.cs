using System;
using Microsoft.EntityFrameworkCore.Migrations;
using Npgsql.EntityFrameworkCore.PostgreSQL.Metadata;

#nullable disable

namespace TierModel.Service.Data.Migrations
{
    /// <inheritdoc />
    public partial class JitAccess : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "JitAction",
                table: "runs",
                type: "character varying(16)",
                maxLength: 16,
                nullable: true);

            migrationBuilder.AddColumn<long>(
                name: "JitRequestId",
                table: "runs",
                type: "bigint",
                nullable: true);

            migrationBuilder.AddColumn<bool>(
                name: "OnJitGranted",
                table: "notification_channels",
                type: "boolean",
                nullable: false,
                defaultValue: false);

            migrationBuilder.AddColumn<bool>(
                name: "OnJitRequested",
                table: "notification_channels",
                type: "boolean",
                nullable: false,
                defaultValue: false);

            migrationBuilder.CreateTable(
                name: "jit_groups",
                columns: table => new
                {
                    Id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    Group = table.Column<string>(type: "character varying(256)", maxLength: 256, nullable: false),
                    GroupSid = table.Column<string>(type: "character varying(184)", maxLength: 184, nullable: true),
                    DisplayName = table.Column<string>(type: "character varying(128)", maxLength: 128, nullable: false),
                    Tier = table.Column<int>(type: "integer", nullable: true),
                    MaxMinutes = table.Column<int>(type: "integer", nullable: false),
                    RequiresApproval = table.Column<bool>(type: "boolean", nullable: false),
                    MinimumRole = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    EligibleUsers = table.Column<string[]>(type: "text[]", nullable: false),
                    Enabled = table.Column<bool>(type: "boolean", nullable: false),
                    CreatedBy = table.Column<string>(type: "character varying(256)", maxLength: 256, nullable: false),
                    CreatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    UpdatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_jit_groups", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "jit_requests",
                columns: table => new
                {
                    Id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    RequestedBy = table.Column<string>(type: "character varying(256)", maxLength: 256, nullable: false),
                    MemberAccount = table.Column<string>(type: "character varying(256)", maxLength: 256, nullable: false),
                    JitGroupId = table.Column<long>(type: "bigint", nullable: true),
                    Group = table.Column<string>(type: "character varying(256)", maxLength: 256, nullable: false),
                    GroupDisplayName = table.Column<string>(type: "character varying(128)", maxLength: 128, nullable: false),
                    Tier = table.Column<int>(type: "integer", nullable: true),
                    Minutes = table.Column<int>(type: "integer", nullable: false),
                    Justification = table.Column<string>(type: "character varying(1000)", maxLength: 1000, nullable: false),
                    Status = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    ApprovalRequired = table.Column<bool>(type: "boolean", nullable: false),
                    RequestedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    ApprovalExpiresAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    DecidedBy = table.Column<string>(type: "character varying(256)", maxLength: 256, nullable: true),
                    DecidedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    DecisionComment = table.Column<string>(type: "character varying(1000)", maxLength: 1000, nullable: true),
                    GrantedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    ExpiresAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    RevokedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    RevokedBy = table.Column<string>(type: "character varying(256)", maxLength: 256, nullable: true),
                    RunId = table.Column<long>(type: "bigint", nullable: true),
                    RevokeRunId = table.Column<long>(type: "bigint", nullable: true),
                    GroupSid = table.Column<string>(type: "character varying(184)", maxLength: 184, nullable: true),
                    MemberSid = table.Column<string>(type: "character varying(184)", maxLength: 184, nullable: true),
                    Dc = table.Column<string>(type: "character varying(253)", maxLength: 253, nullable: true),
                    Message = table.Column<string>(type: "text", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_jit_requests", x => x.Id);
                    table.ForeignKey(
                        name: "FK_jit_requests_jit_groups_JitGroupId",
                        column: x => x.JitGroupId,
                        principalTable: "jit_groups",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.SetNull);
                });

            migrationBuilder.CreateIndex(
                name: "IX_runs_JitRequestId",
                table: "runs",
                column: "JitRequestId");

            migrationBuilder.CreateIndex(
                name: "IX_jit_groups_Group",
                table: "jit_groups",
                column: "Group",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_jit_requests_JitGroupId",
                table: "jit_requests",
                column: "JitGroupId");

            migrationBuilder.CreateIndex(
                name: "IX_jit_requests_RequestedBy_Id",
                table: "jit_requests",
                columns: new[] { "RequestedBy", "Id" });

            migrationBuilder.CreateIndex(
                name: "IX_jit_requests_Status_ExpiresAt",
                table: "jit_requests",
                columns: new[] { "Status", "ExpiresAt" });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "jit_requests");

            migrationBuilder.DropTable(
                name: "jit_groups");

            migrationBuilder.DropIndex(
                name: "IX_runs_JitRequestId",
                table: "runs");

            migrationBuilder.DropColumn(
                name: "JitAction",
                table: "runs");

            migrationBuilder.DropColumn(
                name: "JitRequestId",
                table: "runs");

            migrationBuilder.DropColumn(
                name: "OnJitGranted",
                table: "notification_channels");

            migrationBuilder.DropColumn(
                name: "OnJitRequested",
                table: "notification_channels");
        }
    }
}
