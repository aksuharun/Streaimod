import { Component } from '@geajs/core'
import { Button, Card, CardHeader, CardTitle, CardContent } from '@geajs/ui'
import { router } from '../router'

export default class NotFound extends Component {
  template() {
    return (
      <div class="flex flex-col items-center justify-center min-h-[60vh] px-4 py-12">
        <Card class="max-w-md w-full border border-border/40 bg-card/25 backdrop-blur-md text-center py-8 shadow-2xl">
          <CardHeader class="flex flex-col items-center">
            {/* Pulsing warning symbol */}
            <div class="w-20 h-20 rounded-full bg-rose-500/10 flex items-center justify-center mb-6 text-rose-500 border border-rose-500/20 animate-pulse">
              <svg xmlns="http://www.w3.org/2000/svg" width="38" height="38" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <circle cx="12" cy="12" r="10"/>
                <line x1="12" y1="8" x2="12" y2="12"/>
                <line x1="12" y1="16" x2="12.01" y2="16"/>
              </svg>
            </div>
            
            <h2 class="text-6xl font-black font-mono text-rose-500 tracking-wider">404</h2>
            <CardTitle class="text-xl font-bold mt-4">Page Not Found</CardTitle>
          </CardHeader>
          <CardContent class="space-y-6">
            <p class="text-sm text-muted-foreground max-w-xs mx-auto">
              The page you are looking for does not exist or has been moved.
            </p>
            <div class="pt-4 border-t border-border/10">
              <Button click={() => router.push('/')} class="w-full justify-center">
                Return to Dashboard
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    )
  }
}
