import {AePage,AeBatchPage} from './AePage.js';
import { CharactersPage } from './CharactersPage.js';
import { ContentSourcesPage } from './ContentSourcesPage.js';
import { ContentDraftsPage } from './ContentDraftsPage.js';
import {RecordingsPage} from './RecordingsPage.js';
import {MediaProcessingPage} from './MediaProcessingPage.js';
import {TranscriptionsPage} from './TranscriptionsPage.js';
import {FrameReviewPage} from '../reviews/FrameReviewPage.js';
import { BatchesPage,BatchDetailPage } from './BatchesPage.js';
import { ReviewInboxPage } from './Reviews.js';
import { Route, Routes } from 'react-router-dom';
import {lazy} from 'react';
import type { Me } from '@digitalguide/contracts';
import { StudioNav } from './shared.js';
import { BrandsPage, ProjectsPage, TemplatesPage } from './LibraryPages.js';
import { ClonesPage, ImportsPage } from './ImportClonePages.js';
import { EditorPage } from './EditorPage.js';
import { MediaPage } from './MediaPage.js';
import { VoicePage } from './VoicePage.js';
import './studio.css';
const AssistantPage=lazy(()=>import('./assistant/AssistantPage.js').then(m=>({default:m.AssistantPage})));
const PresentationsPage=lazy(()=>import('../presentations/PresentationsPage.js').then(m=>({default:m.PresentationsPage})));
export function StudioPage({ workspaceId,role }: { workspaceId: string; role: Me['role'] }) {
  const props = { workspaceId,writable: ['admin','editor'].includes(role) };
  if (!workspaceId) return <p role="status">正在读取工作空间…</p>;
  return <div className="studio"><StudioNav/><Routes>
    <Route index element={<ProjectsPage {...props}/>}/>
    <Route path="assistant" element={<AssistantPage key={workspaceId} {...props}/>}/>
    <Route path="projects/:projectId" element={<EditorPage {...props}/>}/>
    <Route path="content" element={<ContentSourcesPage key={workspaceId} {...props}/>}/>
    <Route path="drafts" element={<ContentDraftsPage key={workspaceId} {...props}/>}/>
    <Route path="recordings" element={<RecordingsPage key={workspaceId} {...props}/>}/>
    <Route path="processing" element={<MediaProcessingPage key={workspaceId} {...props}/>}/>
    <Route path="transcriptions" element={<TranscriptionsPage key={workspaceId} {...props}/>}/>
    <Route path="characters" element={<CharactersPage key={workspaceId} {...props}/>}/>
    <Route path="voice" element={<VoicePage key={workspaceId} {...props}/>}/>
    <Route path="ae" element={<AePage {...props}/>}/><Route path="ae/:batchId" element={<AeBatchPage {...props}/>}/><Route path="templates" element={<TemplatesPage {...props}/>}/>
    <Route path="brands" element={<BrandsPage {...props}/>}/>
    <Route path="imports" element={<ImportsPage {...props}/>}/>
    <Route path="presentations" element={<PresentationsPage key={workspaceId} {...props}/>}/>
    <Route path="media" element={<MediaPage {...props}/>}/>
    <Route path="packages" element={<MediaPage {...props} mode="package"/>}/>
    <Route path="batches" element={<BatchesPage {...props}/>}/>
    <Route path="batches/:batchId" element={<BatchDetailPage {...props}/>}/>
    <Route path="reviews" element={<ReviewInboxPage {...props}/>}/>
    <Route path="frame-reviews" element={<FrameReviewPage key={workspaceId} {...props} canComment={['admin','editor','reviewer'].includes(role)}/>}/>
    <Route path="clones" element={<ClonesPage {...props}/>}/>
    <Route path="*" element={<p>创作页面不存在，请从上方导航进入。</p>}/>
  </Routes></div>;
}
