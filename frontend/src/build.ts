import { readFileSync, writeFileSync, mkdirSync, existsSync, copyFileSync, readdirSync, statSync } from "fs";
import { join, basename } from "path";

function copyDirectory(src: string, dest: string) {
  if (!existsSync(src)) return;
  
  mkdirSync(dest, { recursive: true });
  
  const files = readdirSync(src);
  for (const file of files) {
    const srcPath = join(src, file);
    const destPath = join(dest, file);
    
    if (statSync(srcPath).isDirectory()) {
      copyDirectory(srcPath, destPath);
    } else {
      copyFileSync(srcPath, destPath);
    }
  }
}

async function build() {
  console.log("🏗️  Building frontend with Bun...");
  
  // Clean and create dist directory
  const distDir = "dist";
  if (existsSync(distDir)) {
    await Bun.$`rm -rf ${distDir}`;
  }
  mkdirSync(distDir, { recursive: true });

  try {
    // Build JavaScript/TypeScript with Bun
    console.log("📦 Bundling JavaScript...");
    const result = await Bun.build({
      entrypoints: ["src/main.tsx"],
      outdir: distDir,
      target: "browser",
      minify: true,
      splitting: true,
      sourcemap: false,
      naming: {
        entry: "[dir]/[name]-[hash].[ext]",
        chunk: "[dir]/[name]-[hash].[ext]",
        asset: "[dir]/[name]-[hash].[ext]",
      },
      define: {
        "process.env.NODE_ENV": '"production"',
      },
    });

    if (!result.success) {
      console.error("❌ Build failed:");
      for (const message of result.logs) {
        console.error(message);
      }
      process.exit(1);
    }

    // Get the generated files for HTML injection
    const outputFiles = result.outputs;
    const jsFiles = outputFiles.filter(file => file.path.endsWith('.js'));
    const cssFiles = outputFiles.filter(file => file.path.endsWith('.css'));
    
    console.log("📄 Processing HTML...");
    
    // Read and process HTML
    const htmlContent = readFileSync("index.html", "utf-8");
    let processedHtml = htmlContent;

    processedHtml = processedHtml.replace(
      '<script type="module" src="/src/main.tsx"></script>',
      ''
    );
    
    // Add CSS files
    const cssInjects = cssFiles.map(file => {
      const relativePath = basename(file.path);
      return `<link rel="stylesheet" href="/${relativePath}">`;
    }).join('\n    ');
    
    // Add JS files
    const jsInjects = jsFiles.map(file => {
      const relativePath = basename(file.path);
      return `<script type="module" src="/${relativePath}"></script>`;
    }).join('\n    ');
    
    // Inject the files before closing head and body tags
    if (cssInjects) {
      processedHtml = processedHtml.replace('</head>', `    ${cssInjects}\n  </head>`);
    }
    if (jsInjects) {
      processedHtml = processedHtml.replace('</body>', `    ${jsInjects}\n  </body>`);
    }
    
    // Write processed HTML
    writeFileSync(join(distDir, "index.html"), processedHtml);
    
    // Copy static assets if they exist
    console.log("📁 Copying static assets...");
    const publicDir = "public";
    if (existsSync(publicDir)) {
      copyDirectory(publicDir, distDir);
    }
    
    // Copy favicon and other root assets
    const rootAssets = ["favicon.ico", "robots.txt", "manifest.json"];
    for (const asset of rootAssets) {
      if (existsSync(asset)) {
        copyFileSync(asset, join(distDir, asset));
      }
    }
    
    console.log("✅ Build completed successfully!");
    console.log(`📊 Generated ${outputFiles.length} files:`);
    for (const file of outputFiles) {
      const size = (file.size / 1024).toFixed(2);
      console.log(`   ${basename(file.path)} (${size} KB)`);
    }
    
  } catch (error) {
    console.error("❌ Build failed:", error);
    process.exit(1);
  }
}

// Run the build
build();
