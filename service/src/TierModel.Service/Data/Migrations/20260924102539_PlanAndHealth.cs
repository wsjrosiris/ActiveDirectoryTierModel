using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace TierModel.Service.Data.Migrations
{
    /// <inheritdoc />
    public partial class PlanAndHealth : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "Plan",
                table: "runs",
                type: "jsonb",
                nullable: true);

            migrationBuilder.AddColumn<long>(
                name: "PlanRunId",
                table: "runs",
                type: "bigint",
                nullable: true);

            migrationBuilder.AddColumn<bool>(
                name: "OnCertificate",
                table: "notification_channels",
                type: "boolean",
                nullable: false,
                defaultValue: false);

            // Channels that report failures should also warn about an expiring certificate.
            migrationBuilder.Sql("UPDATE notification_channels SET \"OnCertificate\" = \"OnFailure\";");

            migrationBuilder.CreateIndex(
                name: "IX_runs_PlanRunId",
                table: "runs",
                column: "PlanRunId");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_runs_PlanRunId",
                table: "runs");

            migrationBuilder.DropColumn(
                name: "Plan",
                table: "runs");

            migrationBuilder.DropColumn(
                name: "PlanRunId",
                table: "runs");

            migrationBuilder.DropColumn(
                name: "OnCertificate",
                table: "notification_channels");
        }
    }
}
