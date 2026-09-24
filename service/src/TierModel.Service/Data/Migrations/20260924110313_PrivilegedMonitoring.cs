using System;
using Microsoft.EntityFrameworkCore.Migrations;
using Npgsql.EntityFrameworkCore.PostgreSQL.Metadata;

#nullable disable

namespace TierModel.Service.Data.Migrations
{
    /// <inheritdoc />
    public partial class PrivilegedMonitoring : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "Kind",
                table: "schedules",
                type: "character varying(24)",
                maxLength: 24,
                nullable: false,
                defaultValue: "Audit");

            migrationBuilder.AddColumn<bool>(
                name: "OnPrivilegedChange",
                table: "notification_channels",
                type: "boolean",
                nullable: false,
                defaultValue: false);

            migrationBuilder.CreateTable(
                name: "privileged_snapshots",
                columns: table => new
                {
                    Id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    RunId = table.Column<long>(type: "bigint", nullable: false),
                    TakenAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    DomainId = table.Column<int>(type: "integer", nullable: false, defaultValue: 1),
                    Data = table.Column<string>(type: "jsonb", nullable: false),
                    Evaluation = table.Column<string>(type: "jsonb", nullable: false),
                    GroupCount = table.Column<int>(type: "integer", nullable: false),
                    MemberCount = table.Column<int>(type: "integer", nullable: false),
                    ChangeCount = table.Column<int>(type: "integer", nullable: false),
                    UnexpectedCount = table.Column<int>(type: "integer", nullable: false),
                    HygieneCount = table.Column<int>(type: "integer", nullable: false),
                    AttackPathCount = table.Column<int>(type: "integer", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_privileged_snapshots", x => x.Id);
                    table.ForeignKey(
                        name: "FK_privileged_snapshots_runs_RunId",
                        column: x => x.RunId,
                        principalTable: "runs",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_privileged_snapshots_DomainId_Id",
                table: "privileged_snapshots",
                columns: new[] { "DomainId", "Id" });

            migrationBuilder.CreateIndex(
                name: "IX_privileged_snapshots_RunId",
                table: "privileged_snapshots",
                column: "RunId",
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "privileged_snapshots");

            migrationBuilder.DropColumn(
                name: "Kind",
                table: "schedules");

            migrationBuilder.DropColumn(
                name: "OnPrivilegedChange",
                table: "notification_channels");
        }
    }
}
