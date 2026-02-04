using System.Text;
using Microsoft.CodeAnalysis;
using Microsoft.CodeAnalysis.CSharp;

var builder = WebApplication.CreateBuilder(args);

builder.Services.AddCors(options =>
{
	options.AddDefaultPolicy(policy =>
	{
		policy.AllowAnyOrigin().AllowAnyHeader().AllowAnyMethod();
	});
});

var app = builder.Build();

app.UseCors();

var codeDir = Path.Combine(AppContext.BaseDirectory, "..", "CodeFiles");
Directory.CreateDirectory(codeDir);

app.MapPost("/api/code/{name}", async (HttpRequest req, string name) =>
{
	using var reader = new StreamReader(req.Body, Encoding.UTF8);
	var body = await reader.ReadToEndAsync();
	// Expect JSON: { "content": "..." }
	try
	{
		var doc = System.Text.Json.JsonDocument.Parse(body);
		if (!doc.RootElement.TryGetProperty("content", out var contentEl))
			return Results.BadRequest("Missing content");

		var content = contentEl.GetString() ?? string.Empty;
		var filePath = Path.Combine(codeDir, name + ".cs");
		await File.WriteAllTextAsync(filePath, content, Encoding.UTF8);
		return Results.Ok();
	}
	catch (System.Text.Json.JsonException)
	{
		return Results.BadRequest("Invalid JSON");
	}
});

app.MapGet("/api/code/{name}", async (string name) =>
{
	var filePath = Path.Combine(codeDir, name + ".cs");
	if (!File.Exists(filePath)) return Results.NotFound();
	var content = await File.ReadAllTextAsync(filePath, Encoding.UTF8);
	return Results.Json(new { content });
});

app.MapPost("/api/diagnostics", async (HttpRequest req) =>
{
	using var reader = new StreamReader(req.Body, Encoding.UTF8);
	var body = await reader.ReadToEndAsync();
	try
	{
		var doc = System.Text.Json.JsonDocument.Parse(body);
		if (!doc.RootElement.TryGetProperty("content", out var contentEl))
			return Results.BadRequest("Missing content");

		var content = contentEl.GetString() ?? string.Empty;

		var syntaxTree = CSharpSyntaxTree.ParseText(content);

		var refs = AppDomain.CurrentDomain.GetAssemblies()
			.Where(a => !a.IsDynamic && !string.IsNullOrEmpty(a.Location))
			.Select(a => MetadataReference.CreateFromFile(a.Location))
			.Cast<MetadataReference>();

		var compilation = CSharpCompilation.Create("InMemoryCompilation",
			new[] { syntaxTree },
			refs,
			new CSharpCompilationOptions(OutputKind.DynamicallyLinkedLibrary));

		var diags = compilation.GetDiagnostics()
			.Select(d =>
			{
				var span = d.Location.GetLineSpan();
				return new
				{
					Id = d.Id,
					Severity = d.Severity.ToString(),
					Message = d.GetMessage(),
					Range = new
					{
						StartLine = span.StartLinePosition.Line + 1,
						StartColumn = span.StartLinePosition.Character + 1,
						EndLine = span.EndLinePosition.Line + 1,
						EndColumn = span.EndLinePosition.Character + 1
					}
				};
			});

		return Results.Json(diags);
	}
	catch (System.Text.Json.JsonException)
	{
		return Results.BadRequest("Invalid JSON");
	}
});

app.Run();
