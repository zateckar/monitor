
# LLM guidelines
- never say any form of : you’re absolutely right
- Always ultrathink
- Give shorter explanation possible when asked
- Always investigate the user's request before answering do not just agree blindly verify then proceeed.
- "think hard, answer in short"
- Always use the latest information and data to answer the user's request this means using the tools to get the latest information before answering -Always think from First principles. Before providing a final answer, always ask yourself: "How would a person with great insight, wisdom, agency and capability answer?”
- When stuck: What's the most important question i should be asking, that I haven't yet?

# Project Guidelines

## Tech Stack
- **Runtime**: Bun (replace Node.js/npm for all operations)
- **Frontend**: React 18 + TypeScript + MUI + Styled Components
- **Backend**: ElysiaJS + TypeScript
- **Database**: SQLite with Bun's native support
- **Bundling**: Bun for both frontend and backend

## Project Structure
```
monitor/
├── backend/
│   └── src/
│       ├── config/          # Configuration files
│       ├── routes/          # API route handlers
│       ├── services/        # Business logic services
│       ├── types/           # TypeScript type definitions
│       ├── utils/           # Utility functions
│       └── index.ts         # Server entry point
├── frontend/
│   └── src/
│       ├── components/      # React components
│       │   └── settings/    # Settings-specific components
│       ├── contexts/        # React context providers
│       ├── utils/           # Frontend utilities
│       ├── types.ts         # Frontend type definitions
│       ├── App.tsx          # Main app component
│       └── main.tsx         # React entry point
└── .clinerules/            # Project guidelines
```

## Development Standards

### File Organization
- **Controllers**: `backend/src/routes/` - API endpoint handlers
- **Services**: `backend/src/services/` - Business logic and external integrations
- **Components**: `frontend/src/components/` - Reusable React components
- **Types**: Separate type files for frontend and backend
- **Utils**: Helper functions organized by domain

### Naming Conventions
- **Files**: kebab-case for directories, PascalCase for components
- **Components**: PascalCase, file name matches component name
- **Functions**: camelCase
- **Constants**: UPPER_SNAKE_CASE
- **Database**: snake_case for tables and columns

### Code Standards
- **TypeScript**: Strict mode enabled, define interfaces for all props/params
- **Components**: Function components with hooks only
- **Single Responsibility**: Each file/component handles one concern
- **Import Order**: External libraries → internal utilities → components
- **Error Handling**: Always handle errors with proper user feedback

### Backend Patterns
- **Routes**: Thin controllers that delegate to services
- **Services**: Contains business logic and data operations
- **Validation**: Input validation at route level
- **Database**: Use Bun's SQLite integration consistently

### Frontend Patterns
- **State Management**: React Context for global state, local state for components
- **Styling**: MUI components + Styled Components for custom styles
- **Data Fetching**: Centralized API calls in service functions
- **Form Handling**: Controlled components with validation

## Best Practices

### Performance
- Lazy load components when possible
- Optimize database queries in services
- Use React.memo for expensive components
- Minimize bundle size with proper imports

### Security
- Validate all inputs at API boundaries
- Use TypeScript for compile-time safety
- Sanitize data before database operations
- Implement proper authentication/authorization

### Maintainability
- Write self-documenting code with clear variable names
- Keep functions small and focused
- Use consistent patterns across similar features
- Document complex business logic with comments

## Common Commands
bun start                    # Start full application on http://localhost:3001

bun add <package>           # Add dependency
bun add -d <package>        # Add dev dependency

